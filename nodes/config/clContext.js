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

module.exports = function(RED) {
  function OpenCLContext (config) {
    RED.nodes.createNode(this, config);

    this.platformIndex = +config.platformIndex;
    this.deviceIndex = +config.deviceIndex;
    this.context = null;
  }

  OpenCLContext.prototype.getContext = async function() {
    if (!this.context) {
      const platformInfo = nodencl.getPlatformInfo()[this.platformIndex];
      this.log(JSON.stringify(platformInfo, null, 2));
      // node.log(platformInfo.vendor, platformInfo.devices[this.deviceIndex].type);
    
      this.context = await nodencl.createContext({
        platformIndex: this.platformIndex, 
        deviceIndex: this.deviceIndex
      });
      return this.context;
    } else {
      return this.context;
    }
  };

  RED.nodes.registerType('OpenCL Context', OpenCLContext);
};
