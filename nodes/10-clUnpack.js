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
  function clUnpack (config) {
    RED.nodes.createNode(this, config);
    clValve.call(this, RED, config);

    const node = this;
    const numInputs = 1;
    let frameNum = 0;
    const sendDevice = config.sendDeviceBuffer;

    const clContext = RED.nodes.getNode(config.clContext);
    if (!clContext)
      return node.warn('OpenCL Context config not found!!');

    async function setupReader(context, width, height, srcColSpec, dstColSpec) {
      node.width = width;
      node.height = height;

      const reader = new node.io.reader(context, width, height, srcColSpec, dstColSpec);
      await reader.init();

      const numBytesSrc = node.io.getPitchBytes(width) * height;
      node.packedSrc = await context.createBuffer(numBytesSrc, 'readonly', 'coarse');

      const numBytesRGBA = node.width * node.height * 4 * 4;
      node.rgbaDst = [];
      for (let i=0; i<config.maxBuffer+1; ++i)
        node.rgbaDst.push(await context.createBuffer(numBytesRGBA, 'readwrite', 'coarse'));
    
      return reader;
    }

    async function readGrain(srcBuf) {
      let packedSrc = node.packedSrc;
      if (srcBuf.hasOwnProperty('hostAccess'))
        packedSrc = srcBuf;
      else
        await packedSrc.hostAccess('writeonly', srcBuf);
      const rgbaDst = node.rgbaDst[(frameNum++)%config.maxBuffer+1];

      /*let timings = */await node.reader.fromPacked(packedSrc, rgbaDst);
      // console.log(`read: ${timings.dataToKernel}, ${timings.kernelExec}, ${timings.dataFromKernel}, ${timings.totalTime}`);

      if (!sendDevice)
        await rgbaDst.hostAccess('readonly');
      return rgbaDst;
    }

    this.getProcessSources = cable => cable.filter((c, i) => i < numInputs);

    this.makeDstTags = (srcTags) => {
      let dstTags = JSON.parse(JSON.stringify(srcTags));
      switch(srcTags.packing) {
      case 'v210': node.io = v210_io; break;
      case 'RGBA8': node.io = rgba8_io; break;
      default: throw new Error('Unsupported grain format in OpenCL unpack');
      }

      if ('video' === dstTags.format) {
        dstTags.bits = 32;
        dstTags.packing = 'RGBA_f32';
        dstTags.sampling = 'RGBA-4:4:4:4';
        dstTags.colorimetry = config.dstColorimetry;
      }
      return dstTags;
    };

    this.setInfo = (srcTags, dstTags/*, logLevel*/) => {
      const srcVideoTags = srcTags.filter(t => t.format === 'video');
      const srcColSpec = colMaths.getColSpec(srcVideoTags[0].colorimetry, srcVideoTags[0].height);
      const dstColSpec = colMaths.getColSpec(dstTags.video.colorimetry, dstTags.video.height);
      return clContext.getContext()
        .then(context => setupReader(context, srcVideoTags[0].width, srcVideoTags[0].height, srcColSpec, dstColSpec))
        .then(reader => node.reader = reader);
    };

    this.processGrain = (flowType, srcBufArray) => {
      if ('video' === flowType) {
        return readGrain(srcBufArray[0]);
      } else
        return srcBufArray[0];
    };

    this.quit = cb => cb();
    this.closeValve = done => this.close(done);
  }
  util.inherits(clUnpack, clValve);
  RED.nodes.registerType('OpenCL unpack', clUnpack);
};
