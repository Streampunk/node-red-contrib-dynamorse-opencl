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
  // node.log(JSON.stringify(platformInfo, null, 2));
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
    this.initialised = false;
    this.context = createContext(this, this.platformIndex, this.deviceIndex);
  }

  OpenCLContext.prototype.getContext = function() {
    return this.context;
  };

  RED.nodes.registerType('OpenCL Context', OpenCLContext);
};
