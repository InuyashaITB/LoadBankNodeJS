const LoadBank = require('./loadbank');
const loadbank = new LoadBank.LoadBank('/dev/ttyUSB0', 9600, 'none', 1);

var state = 0;
setTimeout(stateMachine, 10);

function stateMachine() {
    var delay = 10;

    switch(state) {
        case 0:
            loadbank.on(LoadBank.Emits.Ready, () => { console.log('LoadBank Ready Received'); });
            loadbank.on(LoadBank.Emits.Error, (err) => { console.log('LoadBank Error:', err); });
            loadbank.on(LoadBank.Emits.GotCurrent, (current) => { console.log('LoadBank Current:', current, 'Amps'); });
            loadbank.on(LoadBank.Emits.GotVoltage, (voltage) => { console.log('LoadBank Voltage:', voltage); });

            loadbank.Open();
            
            state++;
            break;
        case 1:
            if(loadbank.Ready) {
                loadbank.SetConstantVoltage(10);
                // loadbank.SetConstantCurrent(0.5);
                // loadbank.SetConstantResistance(100);
                delay = 1000;
                state++;
            }
            break;
        case 2:
            // loadbank.TurnON();
            state++;
            delay = 1000;
            break;    
        case 3: case 4: case 5: case 6:
            loadbank.GetCurrent();
            delay = 1000;
            state++;
            break;
        case 7:
            // loadbank.SetConstantPower(1);
            // loadbank.SetConstantCurrent(10);
            state++;
            break;
        case 8: case 9: case 10: case 11:
            loadbank.GetCurrent();
            delay = 1000;
            state++;
            break;
        case 12:
            loadbank.TurnOFF();
            state++;
            break;
        
        default: delay = 1000;
    }

    setTimeout(stateMachine, delay);
}
