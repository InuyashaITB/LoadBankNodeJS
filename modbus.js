const SerialPort = require('serialport');
const EventEmitter = require('events');

const Emits = { Error: 'Error', Ready: 'Ready', RegisterRead: 'RegisterRead', CoilRead: 'CoilRead', GotVoltage: 'GotVoltage', GotCurrent: 'GotCurrent' };
const Commands = { ConstantCurrent: 1, ConstantVoltage: 2, ConstantPower: 3, SetResistance: 4, ConstantCurrentSoftStart: 20, DynamicMode: 25, ShortCircuitMode: 26, LISTMode: 27, ConstantCurrentLoadUninstallMode: 31, ConstantPowerLoadingAndUnloadMode: 32, ConstantResistanceLoadUnloadMode: 33, ConstantCurrentTransferVoltageMode: 34, ConstantResistanceSwitchVoltageMode:36, BatteryTestMode: 38, ConstantVoltageSoftStartMode: 39, ChangeSystemParameters: 41, EnterON: 42, EnterOFF: 43 };
const Modes = { CC: Commands.ConstantCurrent, CV: Commands.ConstantVoltage, CP: Commands.ConstantPower, CR: Commands.SetResistance };
const Registers = { CMD: 0x0A00, IFIX: 0x0A01, UFIX: 0x0A03, PFIX: 0x0A05, RFIX: 0x0A07, U: 0x0B00, I: 0x0B02 };
const Coils = { PC1: 0x0500, PC2: 0x0501, TRIG: 0x0502, REMOTE: 0x0503, ISTATE: 0x0510, TRACK: 0x0511, MEMORY: 0x0512, VOICEEN: 0x0513, CONNECT: 0x0514, ATEST: 0x0515, ATESTUN : 0x0516, ATESTPASS: 0x0517, IOVER: 0x0520, UOVER: 0x0521, POVER: 0x0522, HEAT: 0x0523, REVERSE: 0x0524, UNREG: 0x0525, ERREP: 0x0526, ERRCAL: 0x0527 };
const StatusCoils = [Coils.IOVER, Coils.UOVER, Coils.POVER, Coils.HEAT];
const Functions = { ReadCoil: 0x01, WriteCoil: 0x05, ReadRegister: 0x03, WriteRegister: 0x10 };

module.exports.Emits = Emits;
module.exports.Commands = Commands;
module.exports.Modes = Modes;
module.exports.Registers = Registers;
module.exports.Coils = Coils;
module.exports.LoadBank = class LoadBank extends EventEmitter {
    constructor(serial_port, baud, parity, id) { 
        super();
        this.initializing = true;
        this.SetID(id !== null ? id : 1);        
        this._serial = new SerialPort(serial_port, {autoOpen: false, baudRate: baud !== null ? baud : 9600, parity: parity !== null ? parity : 'none'}); 
        this._serial.on('open', () => { console.log("Serial Port Opened"); this._WriteCoil(Coils.PC1, 1); });
        this._serial.on('data', (data) => {
            console.log("Received:", data);
            if(this.initializing)
            {
                this.initializing = false
                this.emit(Emits.Ready);
            }

            var calculated_crc = CalculateCRC(data.slice(1, data.length - 2));
            if(calculated_crc[0] != data[data.length - 2] || calculated_crc[1] != data[data.length - 1]) {
                this.emit(Emits.Error, 'CRC Error');
                return;
            }


            if(data[0] == this._slave_id) {
                switch(data[1]) {
                    case Functions.ReadCoil: 
                        this.emit(Emits.CoilRead, this._last_coil_access, ParseCoilRead(data));
                        break;
                    case Functions.ReadRegister: 
                        this.emit(Emits.RegisterRead, this._last_register_access, ParseRegisterRead(data));
                    break;
                    case Functions.WriteCoil: break;
                    case Functions.WriteRegister: break;
                }
            }
        });
        this._serial.on('close', () => { console.log('Serial Port Closed'); });
        this._serial.open();
        this.on(Emits.ReadRegister, (address, data) => {
            console.log('ReadRegisterCallback- @', address, ':', data);
            switch(address) {
                case Registers.I:    
                    this.emit(Emits.GotCurrent, BytesToFloat(data));               
                    break;

                case Registers.U:
                    this.emit(Emits.GotVoltage, BytesToFloat(data));
                    break;
            }
        });
    }

    SetID(id) { if(id < 1 || id > 255) throw new Error('Invalid ID'); this._slave_id = id; }

    _WriteRegister(address, array) {
        this._last_register_access = address;
        var packet = BuildSendPacket(this._slave_id, Functions.WriteRegister, [ParseAddress(address), array.length, array]);
        this._serial.write(packet);
    }
    _ReadRegister(address, length) {
        this._last_register_access = address;
        var packet = BuildSendPacket(this._slave_id, Functions.ReadRegister, [ParseAddress(address), length]);
        this._serial.write(packet);
    }
    _WriteCoil(address, value) {
        this._last_coil_access = address;
        var packet = BuildSendPacket(this._slave_id, Functions.WriteCoil, [ParseAddress(address), value]);
        this._serial.write(packet);
    }
    _ReadCoil(address) {
        this._last_coil_access = address;
        var packet = BuildSendPacket(this._slave_id, Functions.ReadCoil, ParseAddress(address));
        this._serial.write(packet);
    }

    SendCommand(cmd) {
        this._WriteRegister(Registers.CMD, [cmd]);
    }

    SetMode(mode) {
        if(mode != Modes.CC && mode != Modes.CP && mode != Modes.CV && mode != Modes.CR)
            throw new Error('Invalid Mode');

        this.SendCommand(mode);
    }

    GetStatus() { StatusCoils.forEach(coil => {
        this._ReadCoil(ParseAddress(coil));
    });}
    GetVoltage() { this._ReadRegister(Registers.U, 2); }
    GetCurrent() { this._ReadRegister(Registers.I, 2); }

    SetCurrent(current) { this._WriteRegister(Registers.IFIX, FloatToBytes(current)); }
    SetVoltage(volts) { this._WriteRegister(Registers.UFIX, FloatToBytes(volts)); }
    SetPower(power) { this._WriteRegister(Registers.PFIX, FloatToBytes(power)); }
    SetResistance(resistance) { this._WriteRegister(Registers.RFIX, FloatToBytes(resistance)); }

    TurnON() { this.SendCommand(Commands.EnterON); }
    TurnOFF() { this.SendCommand(Commands.EnterOFF); }
}

function BytesToFloat(data) {
    var values = new Uint16Array(2);
    values[0] = data[3] << 8 | data[4];
    values[1] = data[5] << 8 | data[6];
    var floats = new Float32Array(values);
    return floats[0];
}

function FloatToBytes(float) {
    var float_array = new Float32Array(1);
    float_array[0] = current;
    var bytes = new Uint16Array(float_array);
    return [bytes[1], bytes[0]];
}

function ParseAddress(address) {
    if(Array.isArray(address))
        return address;
    else if (typeof(address) == 'number')
        return [(address & 0xFF00) >> 8, address & 0xFF];
    else
        throw new Error('Failed to parse address: ' + address);
}

function ParseCoilRead(data) {
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
    var length = data[2];
    var results = [];
    for(i = 3; i < data.length - 2; i++)
        results.push(data[i]);
    return results;
}


function CalculateCRC(array) {
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

    return [crc & 0xff, (crc & 0xFF00) >> 8];
}

function BuildSendPacket(slave_id, command, data) {
    var result = [];
    result.push(slave_id & 0xFF);
    result.push(command & 0xFF);
    result.push(data);
    var crc = CalculateCRC(result);
    result.push(crc);
}