/* Copyright 2018 Streampunk Media Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

'use strict';
const util = require('util');
const clValve = require('./clValve.js');
const v210_io = require('../src/v210_io.js');
const rgba8_io = require('../src/rgba8_io.js');
const colMaths = require('../src/colourMaths.js');

module.exports = function (RED) {
  function clPack (config) {
    RED.nodes.createNode(this, config);
    clValve.call(this, RED, config);

    const node = this;
    const numInputs = 1;
    let frameNum = 0;
    const sendDevice = config.sendDeviceBuffer;

    const clContext = RED.nodes.getNode(config.clContext);
    if (!clContext)
      return node.warn('OpenCL Context config not found!!');

    async function setupWriter(context, width, height, colSpec) {
      const writer = new node.io.writer(context, width, height, colSpec);
      await writer.init();

      const numBytesPacked = node.io.getPitchBytes(width) * height;
      node.packedDst = [];
      for (let i=0; i<config.maxBuffer+1; ++i)
        node.packedDst.push(await context.createBuffer(numBytesPacked, 'writeonly', 'coarse'));

      return writer;
    }

    async function writeGrain(src) {
      if (!src.hasOwnProperty('hostAccess'))
        throw new Error('OpenCL pack expects an OpenCL source buffer');

      const packedDst = node.packedDst[frameNum++%config.maxBuffer+1];

      /*let timings = */await node.writer.toPacked(src, packedDst);
      // console.log(`write: ${timings.dataToKernel}, ${timings.kernelExec}, ${timings.dataFromKernel}, ${timings.totalTime}`);

      if (!sendDevice)
        await packedDst.hostAccess('readonly');
      return packedDst;
    }

    this.getProcessSources = cable => cable.filter((c, i) => i < numInputs);

    this.makeDstTags = (srcTags) => {
      switch(config.packing) {
      case 'v210': node.io = v210_io; break;
      case 'RGBA8': node.io = rgba8_io; break;
      default: throw new Error('Unsupported grain format in OpenCL pack');
      }

      let dstTags = JSON.parse(JSON.stringify(srcTags));
      if ('video' === dstTags.format)
        dstTags = node.io.setDestTags(dstTags);
      return dstTags;
    };

    this.setInfo = (srcTags, dstTags/*, logLevel*/) => {
      const srcColSpec = colMaths.getColSpec(dstTags.video.colorimetry, dstTags.video.height);
      return clContext.getContext()
        .then(context => setupWriter(context, dstTags.video.width, dstTags.video.height, srcColSpec))
        .then(writer => node.writer = writer);
    };

    this.processGrain = (flowType, srcBufArray) => {
      if ('video' === flowType) {
        return writeGrain(srcBufArray[0]);
      } else
        return srcBufArray[0];
    };

    this.quit = cb => cb();
    this.closeValve = done => this.close(done);
  }
  util.inherits(clPack, clValve);
  RED.nodes.registerType('OpenCL pack', clPack);
};
