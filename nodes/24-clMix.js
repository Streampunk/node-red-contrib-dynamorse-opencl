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
const mix = require('../src/mix.js');
const oscServer = require('../util/oscServer.js');

module.exports = function (RED) {
  function clMix (config) {
    RED.nodes.createNode(this, config);
    clValve.call(this, RED, config);

    const node = this;
    const numInputs = 2;
    const sendDevice = config.sendDeviceBuffer;
    node.ownerName = `Mix-${node.id}`;

    let mixVal = +config.mix;
    const oscServ = oscServer.getInstance(this);
    oscServ.addControl(config.mixControl, val => mixVal = val);

    const clContextNode = RED.nodes.getNode(config.clContext);
    const clContext = clContextNode ? clContextNode.getContext() : null;
    if (!clContext)
      return node.warn('OpenCL Context config not found!!');

    async function setupMix(width, height) {
      node.numBytesRGBA = width * height * 4 * 4;
      const mixProcess = new mix(node, clContext, width, height);
      await mixProcess.init();

      return mixProcess;
    }

    async function mixGrains(srcArray, mix) {
      srcArray.forEach(src => {
        if (!src.hasOwnProperty('hostAccess'))
          throw new Error('OpenCL mix expects OpenCL source buffers');
      });

      const mixDst = await clContext.createBuffer(node.numBytesRGBA, 'readwrite', 'coarse', node.ownerName);

      /*let timings = */await clContext.checkAlloc(() => node.process.process(srcArray, mixDst, mix));
      // console.log(`write: ${timings.dataToKernel}, ${timings.kernelExec}, ${timings.dataFromKernel}, ${timings.totalTime}`);

      if (!sendDevice)
        await mixDst.hostAccess('readonly');
      return mixDst;
    }

    this.getProcessSources = cable => cable.filter((c, i) => i < numInputs);

    this.makeDstTags = (srcTags) => {
      let dstTags = JSON.parse(JSON.stringify(srcTags));
      return dstTags;
    };

    this.setInfo = (srcTags/*, dstTags, logLevel*/) => {
      const srcVideoTags = srcTags.filter(t => t.format === 'video');
      return setupMix(srcVideoTags[0].width, srcVideoTags[0].height)
        .then(process => node.process = process);
    };

    this.processGrain = (flowType, srcBufArray) => {
      if ('video' === flowType) {
        return mixGrains(srcBufArray, mixVal);
      } else
        return srcBufArray[0];
    };

    this.quit = cb => {
      node.process = null;
      cb();
    };

    this.closeValve = () => {
      node.process = null;
      clContext.releaseBuffers(node.ownerName);
      oscServ.removeControl(config.mixControl);
    };
  }
  util.inherits(clMix, clValve);
  RED.nodes.registerType('OpenCL mix', clMix);
};
