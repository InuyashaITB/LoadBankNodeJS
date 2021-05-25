const EventEmitter = require("events");
const Modbus = require("./modbus");

const Emits = { Error: 'Error', Ready: 'Ready', GotVoltage: 'GotVoltage', GotCurrent: 'GotCurrent' };
const Commands = { ConstantCurrent: 1, ConstantVoltage: 2, ConstantPower: 3, SetResistance: 4, ConstantCurrentSoftStart: 20, DynamicMode: 25, ShortCircuitMode: 26, LISTMode: 27, ConstantCurrentLoadUninstallMode: 31, ConstantPowerLoadingAndUnloadMode: 32, ConstantResistanceLoadUnloadMode: 33, ConstantCurrentTransferVoltageMode: 34, ConstantResistanceSwitchVoltageMode:36, BatteryTestMode: 38, ConstantVoltageSoftStartMode: 39, ChangeSystemParameters: 41, EnterON: 42, EnterOFF: 43 };
const Modes = { CC: Commands.ConstantCurrent, CV: Commands.ConstantVoltage, CP: Commands.ConstantPower, CR: Commands.SetResistance };
const Registers = { CMD: 0x0A00, IFIX: 0x0A01, UFIX: 0x0A03, PFIX: 0x0A05, RFIX: 0x0A07, U: 0x0B00, I: 0x0B02 };
const Coils = { PC1: 0x0500, PC2: 0x0501, TRIG: 0x0502, REMOTE: 0x0503, ISTATE: 0x0510, TRACK: 0x0511, MEMORY: 0x0512, VOICEEN: 0x0513, CONNECT: 0x0514, ATEST: 0x0515, ATESTUN : 0x0516, ATESTPASS: 0x0517, IOVER: 0x0520, UOVER: 0x0521, POVER: 0x0522, HEAT: 0x0523, REVERSE: 0x0524, UNREG: 0x0525, ERREP: 0x0526, ERRCAL: 0x0527 };
const StatusCoils = [Coils.IOVER, Coils.UOVER, Coils.POVER, Coils.HEAT];

var self;
module.exports.Emits = Emits;
module.exports.Commands = Commands;
module.exports.Modes = Modes;
module.exports.Registers = Registers;
module.exports.Coils = Coils;
module.exports.LoadBank = class LoadBank extends EventEmitter {
    constructor(serialPort, baud, parity, slave_id) {
        super();
        self = this;
        this.modbus = new Modbus.Modbus(serialPort, baud, parity, slave_id);
        this.modbus.on(Modbus.Emits.RegisterRead, this.RegisterRead);
        this.modbus.on(Modbus.Emits.RegisterWritten, (addr) => { /*console.log('Register Write Complete:', addr.toString(16));*/ });
        this.modbus.on(Modbus.Emits.CoilWritten, (addr) => { console.log('Coil Write Complete:', addr); if(addr == Coils.PC1) { self.Ready = true; self.emit(Emits.Ready); } });
        this.modbus.on(Modbus.Emits.Ready, () => { this.modbus._WriteCoil(Coils.PC1, 1); });
    }

    Open() { self.modbus.Open(); }

    GetVoltage() { self.modbus._ReadRegister(Registers.U, 2); }
    GetCurrent() { self.modbus._ReadRegister(Registers.I, 2); }

    SetCurrent(current) { self.modbus._WriteRegister(Registers.IFIX, Modbus.FloatToBytes(current)); }
    SetVoltage(volts) { self.modbus._WriteRegister(Registers.UFIX, Modbus.FloatToBytes(volts)); }
    SetPower(power) { self.modbus._WriteRegister(Registers.PFIX, Modbus.FloatToBytes(power)); }
    SetResistance(resistance) { self.modbus._WriteRegister(Registers.RFIX, Modbus.FloatToBytes(resistance)); }

    TurnON() { self.SendCommand(Commands.EnterON); }
    TurnOFF() { self.SendCommand(Commands.EnterOFF); }

    SendCommand(cmd) {
        self.modbus._WriteRegister(Registers.CMD, [0x00, cmd]);
    }

    SetMode(mode) {
        if(mode != Modes.CC && mode != Modes.CP && mode != Modes.CV && mode != Modes.CR)
            throw new Error('Invalid Mode');
        self.SendCommand(mode);
    }
    
    SetConstantCurrent(value) {
        self.SetCurrent(value);
        self.SetMode(Modes.CC);
        self.TurnON();
    }
    
    SetConstantResistance(value){
        self.SetResistance(value);
        self.SetMode(Modes.CR);
        self.TurnON();
    }
    
    SetConstantVoltage(value){
        self.SetVoltage(value);
        self.SetMode(Modes.CV);
        self.TurnON();
    }
    
    SetConstantPower(value){
        self.SetPower(value);
        self.SetMode(Modes.CP);
        self.TurnON();
    }

    RegisterRead(address, data) {
        console.log('ReadRegisterCallback- @', address, ':', data);
        switch(address) {
            case Registers.I:    
                var float = Modbus.BytesToFloat(data);
                self.emit(Emits.GotCurrent, float);               
                break;

            case Registers.U:
                var float = Modbus.BytesToFloat(data);
                self.emit(Emits.GotVoltage, float);
                break;
        }
    }
}