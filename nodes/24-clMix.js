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
    let frameNum = 0;
    const sendDevice = config.sendDeviceBuffer;

    let mixVal = +config.mix;
    const oscServ = oscServer.getInstance(this);
    oscServ.addControl(config.mixControl, val => mixVal = val);

    const clContext = RED.nodes.getNode(config.clContext);
    if (!clContext)
      return node.warn('OpenCL Context config not found!!');

    async function setupMix(context, width, height) {
      const mixProcess = new mix(context, width, height);
      await mixProcess.init();

      const numBytesRGBA = width * height * 4 * 4;
      node.mixDst = [];
      for (let i=0; i<config.maxBuffer+1; ++i)
        node.mixDst.push(await context.createBuffer(numBytesRGBA, 'readwrite', 'coarse'));

      return mixProcess;
    }

    async function mixGrains(srcArray, mix) {
      srcArray.forEach(src => {
        if (!src.hasOwnProperty('hostAccess'))
          throw new Error('OpenCL mix expects OpenCL source buffers');
      });

      const mixDst = node.mixDst[frameNum++%(config.maxBuffer+1)];

      /*let timings = */await node.process.process(srcArray, mixDst, mix);
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
      return clContext.getContext()
        .then(context => setupMix(context, srcVideoTags[0].width, srcVideoTags[0].height))
        .then(process => node.process = process);
    };

    this.processGrain = (flowType, srcBufArray) => {
      if ('video' === flowType) {
        return mixGrains(srcBufArray, mixVal);
      } else
        return srcBufArray[0];
    };

    this.quit = cb => cb();

    this.closeValve = done => {
      oscServ.removeControl(config.mixControl);
      this.close(done);
    };
  }
  util.inherits(clMix, clValve);
  RED.nodes.registerType('OpenCL mix', clMix);
};
