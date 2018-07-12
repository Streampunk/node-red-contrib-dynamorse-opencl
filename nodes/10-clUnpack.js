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
const redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
const Grain = require('node-red-contrib-dynamorse-core').Grain;
const v210_io = require('../src/v210_io.js');

module.exports = function (RED) {
  function clUnpack (config) {
    RED.nodes.createNode(this, config);
    redioactive.Valve.call(this, config);

    const node = this;
    let srcTags = null;
    let dstTags = null;
    let flowID = null;
    let sourceID = null;
    let frameNum = 0;
    const sendDevice = config.sendDeviceBuffer;

    const clContext = RED.nodes.getNode(config.clContext);
    if (!clContext)
      return node.warn('OpenCL Context config not found!!');

    async function setupReader(width, height, colSpec) {
      node.width = width;
      node.height = height;

      const v210Reader = new v210_io.reader(node.oclContext, width, height, colSpec, '2020');
      await v210Reader.init();

      const numBytesV210 = v210_io.getPitchBytes(width) * height;
      node.v210Src = await node.oclContext.createBuffer(numBytesV210, 'readonly', 'coarse');

      const numBytesRGBA = node.width * node.height * 4 * 4;
      node.rgbaDst = [];
      for (let i=0; i<config.maxBuffer+1; ++i)
        node.rgbaDst.push(await node.oclContext.createBuffer(numBytesRGBA, 'readwrite', 'coarse'));
    
      return v210Reader;
    }

    async function readGrain(srcBuf) {
      let v210Src = node.v210Src;
      if (srcBuf.hasOwnProperty('hostAccess'))
        v210Src = srcBuf;
      else
        await v210Src.hostAccess('writeonly', srcBuf);
      const rgbaDst = node.rgbaDst[(frameNum++)%config.maxBuffer+1];

      /*let timings = */await node.v210Reader.fromV210(v210Src, rgbaDst);
      // console.log(`read: ${timings.dataToKernel}, ${timings.kernelExec}, ${timings.dataFromKernel}, ${timings.totalTime}`);

      if (!sendDevice)
        await rgbaDst.hostAccess('readonly');
      return rgbaDst;
    }

    function processGrain(x, push, next) {
      const time = process.hrtime();
      readGrain(x.buffers[0])
        .then(result => {
          var diff = process.hrtime(time);
          node.warn(`Process took ${(diff[0] * 1e9 + diff[1])/1e6} milliseconds`);
          push(null, new Grain(result, x.ptpSync, x.ptpOrigin,
            x.timecode, flowID, sourceID, x.duration));
          return next();
        })
        .catch(err => {
          push(err);
          return next();
        });
    }
  
    this.consume((err, x, push, next) => {
      if (err) {
        push(err);
        next();
      } else if (redioactive.isEnd(x)) {
        push(null, x);
      } else if (Grain.isGrain(x)) {
        const nextJob = (srcTags) ?
          Promise.resolve(x) :
          this.findCable(x)
            .then(cable => {
              if (!Array.isArray(cable[0].video) && cable[0].video.length < 1) {
                return Promise.reject('Logical cable does not contain video');
              }
              srcTags = cable[0].video[0].tags;
              dstTags = JSON.parse(JSON.stringify(srcTags));
              dstTags.bits = 32;
              dstTags.packing = 'RGBA_f32';
              dstTags.sampling = 'RGBA-4:4:4:4';
              const formattedDstTags = JSON.stringify(dstTags, null, 2);
              RED.comms.publish('debug', {
                format: `${config.type} output flow tags:`,
                msg: formattedDstTags
              }, true);
    
              this.makeCable({ video : [{ tags : dstTags }], backPressure : 'video[0]' });
              flowID = this.flowID();
              sourceID = this.sourceID();

              return clContext.getContext();
            })
            .then(context => {
              node.oclContext = context;
              return setupReader(dstTags.width||1920, dstTags.height||1080, '709');
            })
            .then(reader => {
              node.v210Reader = reader;
              return x;
            })
            .catch(err => console.error(err));
  
        nextJob.then(x => {
          processGrain(x, push, next);
        }).catch(err => {
          push(err);
          next();
        });  
      } else {
        push(null, x);
        next();
      }
    });
  
    this.on('close', this.close);
  }
  util.inherits(clUnpack, redioactive.Valve);
  RED.nodes.registerType('OpenCL unpack', clUnpack);
};
