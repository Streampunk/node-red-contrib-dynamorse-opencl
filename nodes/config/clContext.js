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

const nodencl = require('nodencl');

async function createContext(node, platformIndex, deviceIndex) {
  const platformInfo = nodencl.getPlatformInfo()[platformIndex];
  node.log(JSON.stringify(platformInfo, null, 2));
  node.log(`OpenCL context: platform index ${platformIndex}, device index ${deviceIndex}`);
  node.log(`OpenCL context: vendor: ${platformInfo.vendor}, type: ${platformInfo.devices[deviceIndex].type[0]}`);

  return await nodencl.createContext({
    platformIndex: platformIndex, 
    deviceIndex: deviceIndex
  });
}

module.exports = function(RED) {
  function OpenCLContext (config) {
    RED.nodes.createNode(this, config);

    this.platformIndex = +config.platformIndex;
    this.deviceIndex = +config.deviceIndex;
    this.buffers = [];
    this.bufIndex = 0;
    
    this.context = createContext(this, this.platformIndex, this.deviceIndex);

    setInterval(() => { this.buffers.forEach(el => 
      this.log(`${el.index}: ${el.owner} ${el.length} bytes ${el.reserved?'reserved':'free'}`));
    }, 1000);
  }

  OpenCLContext.prototype.getContext = function() {
    this.error('clContext getContext is deprecated');
    return this.context;
  };

  OpenCLContext.prototype.createBuffer = function(numBytes, bufDir, bufType, owner) {
    if (!owner) throw new Error('No owner provided for createBuffer');
      
    const buf = this.buffers.find(el => !el.reserved && (el.length === numBytes) && (el.owner === owner));
    if (buf) {
      buf.reserved = true;
      return buf;
    } else return this.context
      .then(c => c.createBuffer(numBytes, bufDir, bufType))
      .then(buf => {
        buf.reserved = true;
        buf.owner = owner;
        buf.index = this.bufIndex++;
        this.buffers.push(buf);
        buf.release = () => buf.reserved = false;
        return buf;
      });
  };

  OpenCLContext.prototype.releaseBuffers = function(owner) {
    this.buffers = this.buffers.filter(el => el.owner !== owner);
  };

  OpenCLContext.prototype.createProgram = function(kernel, options) {
    return this.context
      .then(c => c.createProgram(kernel, options));
  };

  RED.nodes.registerType('OpenCL Context', OpenCLContext);
};
