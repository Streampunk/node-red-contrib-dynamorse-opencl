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

const osc = require('osc');

function oscServer(node) {
  this.port = 8000;
  this.node = node;
  this.map = [];

  this.oscPort = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort: this.port
  });

  this.oscPort.on('ready', () => {
    this.node.log(`OSC listening on port ${this.port}`);
  });

  this.oscPort.on('message', (oscMessage/*, timeTag, info*/) => {
    const control = oscMessage.address;
    const value = oscMessage.args[0];
    this.node.log(`OSC message: '${control}' value: ${value}`);

    this.map.forEach((entry) => {
      const update = entry[control];
      if (update)
        update(value);
    });
  });

  this.oscPort.on('error', (err) => {
    this.node.log('OSC port error: ', err);
  });

  this.oscPort.open();
}

oscServer.prototype.addControl = function(control, fn) {
  this.map[this.map.length] = { [control]: fn };
};

oscServer.prototype.removeControl = function(control) {
  this.map.forEach((entry, index) => {
    if (entry[control])
      this.map.splice(index, 1);
  });
};

oscServer.prototype.close = function() {
  this.node.log('Closing OSC');
  this.oscPort.close();
};

function getInstance(node) {
  let oscServ = node.context().global.get('oscServ');
  if (!oscServ) {
    oscServ = new oscServer(node);
    node.context().global.set('oscServ', oscServ);
  }

  return oscServ;
}

module.exports = {
  getInstance : getInstance
};