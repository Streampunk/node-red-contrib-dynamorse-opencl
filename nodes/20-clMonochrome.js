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
const monochrome = require('../src/monochrome.js');
const colMaths = require('../src/colourMaths.js');
const oscServer = require('../util/oscServer.js');

module.exports = function (RED) {
  function clMonochrome (config) {
    RED.nodes.createNode(this, config);
    clValve.call(this, RED, config);

    const node = this;
    const numInputs = 1;
    let frameNum = 0;
    const sendDevice = config.sendDeviceBuffer;

    let mixVal = +config.mix;
    const oscServ = oscServer.getInstance(this);
    oscServ.addControl(config.mixControl, val => mixVal = val);

    const clContext = RED.nodes.getNode(config.clContext);
    if (!clContext)
      return node.warn('OpenCL Context config not found!!');

    async function setupMono(context, width, height, colSpec) {
      const monoProcess = new monochrome(context, width, height, colSpec);
      await monoProcess.init();

      const numBytesRGBA = width * height * 4 * 4;
      node.monoDst = [];
      for (let i=0; i<config.maxBuffer+1; ++i)
        node.monoDst.push(await context.createBuffer(numBytesRGBA, 'readwrite', 'coarse'));

      return monoProcess;
    }

    async function monoGrain(src, mix) {
      if (!src.hasOwnProperty('hostAccess'))
        throw new Error('OpenCL monochrome expects an OpenCL source buffer');

      const monoDst = node.monoDst[frameNum++%(config.maxBuffer+1)];

      /*let timings = */await node.process.process(src, monoDst, mix);
      // console.log(`write: ${timings.dataToKernel}, ${timings.kernelExec}, ${timings.dataFromKernel}, ${timings.totalTime}`);

      if (!sendDevice)
        await monoDst.hostAccess('readonly');
      return monoDst;
    }

    this.getProcessSources = cable => cable.filter((c, i) => i < numInputs);

    this.makeDstTags = (srcTags) => {
      let dstTags = JSON.parse(JSON.stringify(srcTags));
      return dstTags;
    };

    this.setInfo = (srcTags/*, dstTags, logLevel*/) => {
      const srcVideoTags = srcTags.filter(t => t.format === 'video');
      const colSpec = colMaths.getColSpec(srcVideoTags[0].colorimetry, srcVideoTags[0].height);
      return clContext.getContext()
        .then(context => setupMono(context, srcVideoTags[0].width, srcVideoTags[0].height, colSpec))
        .then(process => node.process = process);
    };

    this.processGrain = (flowType, srcBufArray) => {
      if ('video' === flowType) {
        return monoGrain(srcBufArray[0], mixVal);
      } else
        return srcBufArray[0];
    };

    this.quit = cb => cb();

    this.closeValve = done => {
      oscServ.removeControl(config.mixControl);
      this.close(done);
    };
  }
  util.inherits(clMonochrome, clValve);
  RED.nodes.registerType('OpenCL monochrome', clMonochrome);
};
