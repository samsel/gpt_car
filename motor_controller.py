from flask import Flask, request
import RPi.GPIO as GPIO
import time
import signal
import sys

app = Flask(__name__)

# Disable GPIO warnings
GPIO.setwarnings(False)
# Use Broadcom pin numbering
GPIO.setmode(GPIO.BCM)

# GPIO pin setup
IN1, IN2 = 17, 27   # Drive motor
IN3, IN4 = 22, 23   # Steering motor

for pin in [IN1, IN2, IN3, IN4]:
    GPIO.setup(pin, GPIO.OUT)
    GPIO.output(pin, GPIO.LOW)

def stop_motors():
    for pin in [IN1, IN2, IN3, IN4]:
        GPIO.output(pin, GPIO.LOW)

def move_forward(duration=2):
    GPIO.output(IN1, GPIO.HIGH)
    GPIO.output(IN2, GPIO.LOW)
    time.sleep(duration)
    stop_motors()

def move_backward(duration=2):
    GPIO.output(IN1, GPIO.LOW)
    GPIO.output(IN2, GPIO.HIGH)
    time.sleep(duration)
    stop_motors()

def turn_left(duration=1):
    GPIO.output(IN3, GPIO.HIGH)
    GPIO.output(IN4, GPIO.LOW)
    time.sleep(duration)
    stop_motors()

def turn_right(duration=1):
    GPIO.output(IN3, GPIO.LOW)
    GPIO.output(IN4, GPIO.HIGH)
    time.sleep(duration)
    stop_motors()

@app.route("/command", methods=["POST"])
def command():
    data = request.json
    cmd = data.get("cmd", "").upper()
    print("Received command:", cmd)

    if cmd == "FORWARD":
        move_forward()
    elif cmd == "BACKWARD":
        move_backward()
    elif cmd == "LEFT":
        turn_left()
    elif cmd == "RIGHT":
        turn_right()
    elif cmd == "STOP":
        stop_motors()
    else:
        return {"status": "error", "message": "Unknown command"}, 400

    return {"status": "ok"}

# Graceful shutdown and cleanup
def cleanup_and_exit(signum=None, frame=None):
    print("\nShutting down, cleaning up GPIO...")
    stop_motors()
    GPIO.cleanup()
    sys.exit(0)

# Handle Ctrl+C or termination
signal.signal(signal.SIGINT, cleanup_and_exit)
signal.signal(signal.SIGTERM, cleanup_and_exit)

if __name__ == "__main__":
    print("Motor control server starting on port 5000...")
    try:
        app.run(host="0.0.0.0", port=5000)
    finally:
        cleanup_and_exit()
