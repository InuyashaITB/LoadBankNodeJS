const LoadBank = require('./modbus');
const loadbank = new LoadBank.LoadBank('COM3', 9600, 'none', 1);

loadbank.on(LoadBank.Emits.Ready, () => { console.log('LoadBank Ready'); });
loadbank.on(LoadBank.Emits.Error, (err) => { console.log('LoadBank Error:', err); });
loadbank.on(LoadBank.Emits.GotCurrent, (current) => { console.log('LoadBank Current:', current); });
loadbank.on(LoadBank.Emits.GotVoltage, (voltage) => { console.log('LoadBank Voltage:', voltage); });

loadbank.TurnON();
loadbank.SetMode(LoadBank.Modes.CC);


setTimeout(() => { process.exit(1); }, 5000);