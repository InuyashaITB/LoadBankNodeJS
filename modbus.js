const SerialPort = require('serialport');
const EventEmitter = require('events');
const Queue = require('queue-fifo');

const Emits = { Error: 'Error', Ready: 'Ready', RegisterRead: 'RegisterRead', CoilRead: 'CoilRead', RegisterWritten: 'RegisterWritten', CoilWritten: 'CoilWritten' };
const Functions = { ReadCoil: 0x01, WriteCoil: 0x05, ReadRegister: 0x03, WriteRegister: 0x10 };

var self;

module.exports.Emits = Emits;
module.exports.Modbus = class Modbus extends EventEmitter {
    constructor(serial_port, baud, parity, id) { 
        super();
        self = this;
        this._last_send_time = 0;
        this._expected_receive_length = 0;
        this._receive_buffer = Buffer.alloc(0);
        this._send_queue = new Queue();
        this.Ready = false;
        this.SetID(id !== null ? id : 1);        
        this._serial = new SerialPort(serial_port, {autoOpen: false, baudRate: baud !== null ? baud : 9600, parity: parity !== null ? parity : 'none', dataBits: 8, stopBits: 1}); 
        this._serial.on('open', () => { console.log("Serial Port Opened"); self.emit(Emits.Ready); });
        this._serial.on('error', (e) => { console.log("Serial Port Error", e); self.emit(Emits.Error, e); });
        this._serial.on('data', (data) => {
            self._receive_buffer = Buffer.concat([self._receive_buffer, data]);
            // console.log(self._receive_buffer);

            if(self._receive_buffer.length < self._expected_receive_length)
                return;

            self._waiting_for_response = false;
            self._send_queue.dequeue();

            console.log("Evaluating full expression:", self._receive_buffer);

            var calculated_crc = CalculateCRC(self._receive_buffer.slice(0, self._receive_buffer.length - 2));
            if(calculated_crc[0] != self._receive_buffer[self._receive_buffer.length - 2] || calculated_crc[1] != self._receive_buffer[self._receive_buffer.length - 1]) {
                self.emit(Emits.Error, 'CRC Error');
                self._receive_buffer = Buffer.alloc(0);
                return;
            }


            if(self._receive_buffer[0] == self._slave_id) {
                switch(self._receive_buffer[1]) {
                    case Functions.ReadCoil: 
                        var data = ParseCoilRead(self._receive_buffer);
                        self.emit(Emits.CoilRead, self._last_address, data);
                        break;
                    case Functions.ReadRegister: 
                        var data = ParseRegisterRead(self._receive_buffer);
                        self.emit(Emits.RegisterRead, self._last_address, data);
                    break;
                    case Functions.WriteCoil: 
                        self.emit(Emits.CoilWritten, self._last_address);
                        break;
                    case Functions.WriteRegister: 
                        self.emit(Emits.RegisterWritten, self._last_address);
                        break;
                }
            }

            self._receive_buffer = Buffer.alloc(0);
        });
        this._serial.on('close', () => { console.log('Serial Port Closed'); });
        
        setInterval(() => {
            if(!self._send_queue.isEmpty() && !self._waiting_for_response && (new Date()).getTime() - self._last_send_time > 250) {
                var packet = self._send_queue.peek();
                self._last_address = packet.address;
                self._expected_receive_length = packet.response_length;
                self._waiting_for_response = true;
                self._last_send_time = (new Date()).getTime();
                self._serial.write(packet.data, (err) => 
                { 
                    if(!err)
                        console.log('Sent:',this._send_queue.peek());
                    else 
                        this.emit(Emits.Error, err); 
                } );
            }
            else if (self._waiting_for_response && (new Date()).getTime() - self._last_send_time > 5000) {
                self.emit(Emits.Error, 'Packet timeout!');
                self._waiting_for_response = false;
            }
        }, 100);
    }

    Open() { self._serial.open(); }
    SetID(id) { if(id < 1 || id > 255) throw new Error('Invalid ID'); self._slave_id = id; }

    _WriteRegister(address, array) {
        self._last_address = address;
        var packet = BuildSendPacket(self._slave_id, Functions.WriteRegister, [AddressToBytes(address), LengthToBytes(array.length / 2), array.length, array]);
        self._send_queue.enqueue({address: address, data: packet, response_length: 8});
    }
    _ReadRegister(address, length) {
        self._last_address = address;
        var packet = BuildSendPacket(self._slave_id, Functions.ReadRegister, [AddressToBytes(address), LengthToBytes(length)]);
        self._send_queue.enqueue({address: address, data: packet, response_length: 3 + (length*2) + 2});
    }
    _WriteCoil(address, value) {
        self._last_address = address;

        if(value)
            value = [0xFF, 0x00];
        else
            value = [0x00, 0x00];

        var packet = BuildSendPacket(self._slave_id, Functions.WriteCoil, [AddressToBytes(address), value]);
        self._send_queue.enqueue({address: address, data: packet, response_length: 8});
    }
    _ReadCoil(address) {
        self._last_address = address;
        var packet = BuildSendPacket(self._slave_id, Functions.ReadCoil, AddressToBytes(address));
        self._send_queue.enqueue({address: address, data: packet, response_length: 6});
    }
}

module.exports.FloatToBytes = function FloatToBytes(float) {
    var buffer = Buffer.alloc(4);
    buffer.writeFloatBE(float);
    return buffer;
}

module.exports.BytesToFloat = function BytesToFloat(data) {
    return Buffer.from(data).readFloatBE(0);
}

function LengthToBytes(length) { 
    var result = [];
    var uint16array = new Uint16Array(1);
    uint16array[0] = length;
    var uint8array = new Uint8Array(uint16array.buffer);
    result.push(uint8array[1]);
    result.push(uint8array[0]);
    return result;
}

function AddressToBytes(address) {
    if(Array.isArray(address))
        return address;
    else if (typeof(address) == 'number')
        return [(address & 0xFF00) >> 8, address & 0xFF];
    else
        throw new Error('Failed to parse address: ' + address);
}

function ParseCoilRead(data) {
    var i;
    var length = data[2];

    if(length == 1)
        return data[3] == 1;
    else
    {
        var results = [];
        for(i = 3; i < data.length - 2; i++) {
            results.push(data[i] == 1);
        }
        return results;
    }
}

function ParseRegisterRead(data) {
    var i;
    var length = data[2];
    var results = [];
    for(i = 3; i < data.length - 2; i++)
        results.push(data[i]);
    console.log('Registers Read:', toHexString(results));
    return results;
}


function CalculateCRC(array) {
    var pos, i;
    var crc = 0xFFFF;
    for(pos = 0; pos < array.length; pos++) {
        crc ^= array[pos];
        for (i = 8; i != 0; i--) {    // Loop over each bit
            if ((crc & 0x0001) != 0) {      // If the LSB is set
              crc >>= 1;                    // Shift right and XOR 0xA001
              crc ^= 0xA001;
            }
            else                            // Else LSB is not set
              crc >>= 1;                    // Just shift right
          }
    }

    var result = [];
    result.push(crc&0xff);
    result.push((crc & 0xFF00) >> 8);
    return result;
}

function BuildSendPacket(slave_id, command, data) {
    var result = [];
    InsertIntoArray(result, slave_id & 0xFF);
    InsertIntoArray(result, command & 0xFF);
    InsertIntoArray(result, data);
    InsertIntoArray(result, CalculateCRC(result));
    
    console.log('BuildSendPacket made:', toHexString(result));
    
    return result;
}

function InsertIntoArray(toArray, fromArray) {
    if(Buffer.isBuffer(fromArray))
    {
        var buffer = [];
        for(var i = 0; i < fromArray.length; i++)   
            buffer[i] = fromArray[i];
        InsertIntoArray(toArray, buffer);
    }
    else if(Array.isArray(fromArray))
        for(var i = 0; i < fromArray.length; i++) {
            if(Array.isArray(fromArray[i]) || Buffer.isBuffer(fromArray[i]))
                InsertIntoArray(toArray, fromArray[i]); // Recursively flatten array if sub-elements are array as well.
            else
                toArray.push(fromArray[i]);
        }
    else
        toArray.push(fromArray);
}

function toHexString(byteArray) {
  return '[' + Array.from(byteArray, function(byte) {
    return '0x' + ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join(',') + ']'
}