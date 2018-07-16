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
      const v210Writer = new v210_io.writer(context, width, height, colSpec);
      await v210Writer.init();

      const numBytesV210 = v210_io.getPitchBytes(width) * height;
      node.v210Dst = [];
      for (let i=0; i<config.maxBuffer+1; ++i)
        node.v210Dst.push(await context.createBuffer(numBytesV210, 'writeonly', 'coarse'));

      return v210Writer;
    }

    async function writeGrain(src) {
      if (!src.hasOwnProperty('hostAccess'))
        throw new Error('OpenCL pack expects an OpenCL source buffer');

      const v210Dst = node.v210Dst[frameNum++%config.maxBuffer+1];

      /*let timings = */await node.v210Writer.toV210(src, v210Dst);
      // console.log(`write: ${timings.dataToKernel}, ${timings.kernelExec}, ${timings.dataFromKernel}, ${timings.totalTime}`);

      if (!sendDevice)
        await v210Dst.hostAccess('readonly');
      return v210Dst;
    }

    this.getProcessSources = cable => cable.filter((c, i) => i < numInputs);

    this.makeDstTags = (srcTags) => {
      let dstTags = JSON.parse(JSON.stringify(srcTags));
      if ('video' === dstTags.format) {
        dstTags.bits = 10;
        dstTags.packing = 'v210';
        dstTags.sampling = 'YCbCr-4:2:2';
      }
      return dstTags;
    };

    this.setInfo = (srcTags/*, dstTags, logLevel*/) => {
      const srcVideoTags = srcTags.filter(t => t.format === 'video');
      const srcColSpec = colMaths.getColSpec(srcVideoTags[0].colorimetry, srcVideoTags[0].height);
      return clContext.getContext()
        .then(context => setupWriter(context, srcVideoTags[0].width, srcVideoTags[0].height, srcColSpec))
        .then(writer => node.v210Writer = writer);
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
