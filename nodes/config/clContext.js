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
    this.clContext = new nodencl.clContext({ 
      platformIndex: this.platformIndex, 
      deviceIndex: this.deviceIndex,
      reservationTimeout: 1000
    }, this);

    const platformInfo = this.clContext.getPlatformInfo();
    // this.logger.log(JSON.stringify(platformInfo, null, 2));
    this.log(`OpenCL context: platform index ${this.platformIndex}, device index ${this.deviceIndex}`);
    this.log(`OpenCL context: vendor: ${platformInfo.vendor}, type: ${platformInfo.devices[this.deviceIndex].type[0]}`);
  
    this.bufLog = setInterval(this.clContext.logBuffers, 1000);
    
    this.on('close', done => {
      clearInterval(this.bufLog);
      this.clContext.close(done);
    });
  }

  OpenCLContext.prototype.getContext = function() {
    return this.clContext;
  };

  RED.nodes.registerType('OpenCL Context', OpenCLContext);
};
