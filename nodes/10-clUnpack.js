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
    const sendDevice = config.sendDeviceBuffer;
    node.ownerName = `Unpack-${node.id}`;

    const clContext = RED.nodes.getNode(config.clContext);
    if (!clContext)
      return node.warn('OpenCL Context config not found!!');

    async function setupReader(width, height, srcColSpec, dstColSpec) {
      node.width = width;
      node.height = height;
      node.numBytesRGBA = node.width * node.height * 4 * 4;

      const reader = new node.io.reader(node, clContext, width, height, srcColSpec, dstColSpec);
      await reader.init();

      return reader;
    }

    async function readGrain(srcBuf) {
      let packedSrc = node.packedSrc;
      if (srcBuf.hasOwnProperty('hostAccess'))
        packedSrc = srcBuf;
      else {
        if (!packedSrc) {
          const numBytesSrc = node.io.getPitchBytes(node.width) * node.height;
          node.packedSrc = await clContext.createBuffer(numBytesSrc, 'readonly', 'coarse', node.ownerName);
          packedSrc = node.packedSrc;
        }
        await packedSrc.hostAccess('writeonly', srcBuf);
      }
      const rgbaDst = await clContext.createBuffer(node.numBytesRGBA, 'readwrite', 'coarse', node.ownerName);

      /*let timings = */await clContext.checkAlloc(() => node.reader.fromPacked(packedSrc, rgbaDst));
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
      return setupReader(srcVideoTags[0].width, srcVideoTags[0].height, srcColSpec, dstColSpec)
        .then(reader => node.reader = reader);
    };

    this.processGrain = (flowType, srcBufArray) => {
      if ('video' === flowType) {
        return readGrain(srcBufArray[0]);
      } else
        return srcBufArray[0];
    };

    this.quit = cb => {
      node.reader = null;
      clContext.releaseBuffers(node.ownerName);
      cb();
    };
    this.closeValve = done => this.close(done);
  }
  util.inherits(clUnpack, clValve);
  RED.nodes.registerType('OpenCL unpack', clUnpack);
};
