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
const blur = require('../src/blur.js');

module.exports = function (RED) {
  function clBlur (config) {
    RED.nodes.createNode(this, config);
    clValve.call(this, RED, config);

    const node = this;
    const numInputs = 1;
    const sendDevice = config.sendDeviceBuffer;
    const blurDepth = +config.blurDepth;
    node.ownerName = `Blur-${node.id}`;

    const clContext = RED.nodes.getNode(config.clContext);
    if (!clContext)
      return node.warn('OpenCL Context config not found!!');

    async function setupBlur(width, height) {
      node.numBytesRGBA = width * height * 4 * 4;
      const blurProcess = new blur(node, clContext, width, height, blurDepth);
      await blurProcess.init();

      return blurProcess;
    }

    async function blurGrain(src) {
      if (!src.hasOwnProperty('hostAccess'))
        throw new Error('OpenCL monochrome expects an OpenCL source buffer');

      const blurDst = await clContext.createBuffer(node.numBytesRGBA, 'readwrite', 'coarse', node.ownerName);

      /*let timings = */await node.process.process(src, blurDst);
      // console.log(`write: ${timings.dataToKernel}, ${timings.kernelExec}, ${timings.dataFromKernel}, ${timings.totalTime}`);

      src.release();

      if (!sendDevice)
        await blurDst.hostAccess('readonly');
      return blurDst;
    }

    this.getProcessSources = cable => cable.filter((c, i) => i < numInputs);

    this.makeDstTags = (srcTags) => {
      let dstTags = JSON.parse(JSON.stringify(srcTags));
      return dstTags;
    };

    this.setInfo = (srcTags/*, dstTags, logLevel*/) => {
      const srcVideoTags = srcTags.filter(t => t.format === 'video');
      return setupBlur(srcVideoTags[0].width, srcVideoTags[0].height)
        .then(process => node.process = process);
    };

    this.processGrain = (flowType, srcBufArray) => {
      if ('video' === flowType) {
        return blurGrain(srcBufArray[0]);
      } else
        return srcBufArray[0];
    };

    this.quit = cb => {
      node.process = null;
      clContext.releaseBuffers(node.ownerName);
      cb();
    };

    this.closeValve = done => this.close(done);
  }
  util.inherits(clBlur, clValve);
  RED.nodes.registerType('OpenCL blur', clBlur);
};
