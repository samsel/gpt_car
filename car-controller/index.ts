import { isRaspberryPi } from "./utils/raspberrypi.js";

export enum Direction {
    FORWARD = "FORWARD",
    BACKWARD = "BACKWARD",
    LEFT = "LEFT",
    RIGHT = "RIGHT",
}

const DEFAULT_DRIVE_DURATION = 2;
const DEFAULT_TURN_DURATION = 1;
const MAX_DURATION = 5;

// GPIO pin mapping for each direction
const DirectionGPIOPinMapping = {
    [Direction.FORWARD]: 17,  
    [Direction.BACKWARD]: 27,
    [Direction.LEFT]: 22,
    [Direction.RIGHT]: 23,
} as const;

// Map directions to their opposites to prevent short-circuits
const OpposingDirection: { [key in Direction]?: Direction } = {
    [Direction.FORWARD]: Direction.BACKWARD,
    [Direction.BACKWARD]: Direction.FORWARD,
    [Direction.LEFT]: Direction.RIGHT,
    [Direction.RIGHT]: Direction.LEFT,
};

// This will store the pigpio module only if it's successfully imported
let GPIO: any = null; 

// Store initialized Gpio instances
const motorPins: { [key in Direction]?: any } = {};

// Store active timeouts to cancel them later
const motorTimeouts: { [key in Direction]?: NodeJS.Timeout } = {};

// Initializes all GPIO pins for the motors.
// Sets them to OUTPUT and ensures they are all OFF.
async function initializePins() {
    if (!isRaspberryPi()) {
        console.log("Not a Raspberry Pi. Skipping GPIO initialization.");
        return;
    }

    try {
        // import pigpio ONLY on a Pi
        GPIO = (await import('pigpio')).default;

        let initialized = false;
        for (const dir of Object.values(Direction)) {
            const pinNumber = DirectionGPIOPinMapping[dir];
            if (pinNumber) {
                const pin = new GPIO.Gpio(pinNumber, { mode: GPIO.Gpio.OUTPUT });
                pin.digitalWrite(0); // Ensure pin is off at start
                motorPins[dir] = pin;
                initialized = true;
            }
        }
        if (initialized) {
            console.log("GPIO pins initialized successfully.");
        }
    } catch (error) {
        console.error("Failed to initialize GPIO pins. Falling back to simulation.", error);
        // Clear any partially initialized pins
        Object.keys(motorPins).forEach(key => delete motorPins[key as Direction]);
    }
}

// Run initialization when the module is loaded
// This is a async call, but the code handles it correctly
// because moveCar() will just simulate until motorPins is populated.
// this type of initialization is common in hardware interfacing code and ok for this use case.
initializePins();

export function moveCar(direction: Direction, duration?: number) {
    const motorPin = motorPins[direction];

    // Fallback to simulation if this pin wasn't initialized (or if GPIO is null)
    if (!motorPin) {
        console.log(`Simulated move car: ${direction} for ${duration ?? 'default'} seconds`);
        return;
    }

    // --- Determine and Clamp Duration ---
    let effectiveDuration: number;
    if (duration === undefined) {
        effectiveDuration = (direction === Direction.FORWARD || direction === Direction.BACKWARD)
            ? DEFAULT_DRIVE_DURATION
            : DEFAULT_TURN_DURATION;
    } else {
        effectiveDuration = duration;
    }

    // Clamp duration between 0 and MAX_DURATION
    const safeDuration = Math.min(Math.max(0, effectiveDuration), MAX_DURATION);
    if (safeDuration !== effectiveDuration) {
        console.warn(`Duration clamped to ${safeDuration}s (was ${effectiveDuration}s)`);
    }

    // 1. Stop the opposing motor and cancel its timeout (prevents shoot-through)
    const opposingDir = OpposingDirection[direction];
    if (opposingDir) {
        stopMotor(opposingDir);
    }

    // 2. Clear any *existing* timeout for the same direction (to reset the timer)
    if (motorTimeouts[direction]) {
        clearTimeout(motorTimeouts[direction]);
        delete motorTimeouts[direction];
    }

    // 3. Activate the desired motor
    motorPin.digitalWrite(1);
    console.log(`Car moving ${direction} for ${safeDuration} seconds`);

    // 4. Set a new timeout to stop this motor
    motorTimeouts[direction] = setTimeout(() => {
        motorPin.digitalWrite(0);
        console.log(`Car stopped moving ${direction}`);
        delete motorTimeouts[direction]; // Clean up the timeout reference
    }, safeDuration * 1000);
}

function stopMotor(dir: Direction) {
    motorPins[dir]?.digitalWrite(0);
    if (motorTimeouts[dir]) {
        clearTimeout(motorTimeouts[dir]);
        delete motorTimeouts[dir];
    }
}