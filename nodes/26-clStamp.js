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
const stamp = require('../src/stamp.js');

module.exports = function (RED) {
  function clStamp (config) {
    RED.nodes.createNode(this, config);
    clValve.call(this, RED, config);

    const node = this;
    const numInputs = 2;
    let frameNum = 0;
    const sendDevice = config.sendDeviceBuffer;
    const premultiplied = config.premultiplied;

    const clContext = RED.nodes.getNode(config.clContext);
    if (!clContext)
      return node.warn('OpenCL Context config not found!!');

    async function setupStamp(context, width, height) {
      const stampProcess = new stamp(context, width, height);
      await stampProcess.init();

      const numBytesRGBA = width * height * 4 * 4;
      node.stampDst = [];
      for (let i=0; i<config.maxBuffer+1; ++i)
        node.stampDst.push(await context.createBuffer(numBytesRGBA, 'readwrite', 'coarse'));

      return stampProcess;
    }

    async function stampGrains(srcArray, premultiplied) {
      srcArray.forEach(src => {
        if (!src.hasOwnProperty('hostAccess'))
          throw new Error('OpenCL stamp expects OpenCL source buffers');
      });

      const stampDst = node.stampDst[frameNum++%(config.maxBuffer+1)];

      /*let timings = */await node.process.process(srcArray, stampDst, premultiplied);
      // console.log(`write: ${timings.dataToKernel}, ${timings.kernelExec}, ${timings.dataFromKernel}, ${timings.totalTime}`);

      if (!sendDevice)
        await stampDst.hostAccess('readonly');
      return stampDst;
    }

    this.getProcessSources = cable => {
      let srcCable = cable.filter((c, i) => i < numInputs);
    
      const alphas = [];
      srcCable.forEach(c => {
        if (c.video && Array.isArray(c.video)) {
          const f = c.video[0];
          let hasAlpha = f.tags.hasAlpha || false;
          if (f.tags.hasAlpha && Array.isArray(f.tags.hasAlpha))
            hasAlpha = ('true' === f.tags.hasAlpha[0]) || ('1' === f.tags.hasAlpha[0]);
          alphas.push(hasAlpha);
        }
      });

      if (!alphas[0] && !alphas[1])
        throw new Error(`${config.type}: no alpha channel found on source video flows`);

      if (!alphas[0] && alphas[1])
        srcCable = srcCable.reverse(); // flow with source alpha must be processed first

      return srcCable;
    };

    this.makeDstTags = (srcTags) => {
      let dstTags = JSON.parse(JSON.stringify(srcTags));
      return dstTags;
    };

    this.setInfo = (srcTags/*, dstTags, logLevel*/) => {
      const srcVideoTags = srcTags.filter(t => t.format === 'video');
      return clContext.getContext()
        .then(context => setupStamp(context, srcVideoTags[0].width, srcVideoTags[0].height))
        .then(process => node.process = process);
    };

    this.processGrain = (flowType, srcBufArray) => {
      if ('video' === flowType) {
        return stampGrains(srcBufArray, premultiplied);
      } else
        return srcBufArray[0];
    };

    this.quit = cb => cb();

    this.closeValve = done => this.close(done);
  }
  util.inherits(clStamp, clValve);
  RED.nodes.registerType('OpenCL stamp', clStamp);
};
