function SoundChip(sampleRate) {
    var register = [ 0, 0, 0, 0 ];
    var counter = [ 0, 0, 0, 0 ];
    var outputBit = [ 0, 0, 0, 0 ];
    var volume = [ 0, 0, 0, 0 ];
    var generators = [ null, null, null, null ];

    const soundchipFreq = 3546893.0 / 16.0; // PAL
    const sampleDecrement = soundchipFreq / sampleRate;

    var volumeTable = [];
    var f = 1.0;
    for (var i = 0; i < 16; ++i) {
        volumeTable[i] = f;
        f *= Math.pow(10, -0.1);
    }
    volumeTable[15] = 0;

    function toneChannel(channel, out, offset, length) {
        const reg = register[channel], vol = volume[channel];;
        if (reg <= 1) {
            for (var i = 0; i < length; ++i) {
                out[i + offset] += volume[channel];
            }
            return;
        }
        for (var i = 0; i < length; ++i) {
            counter[channel] -= sampleDecrement;
            if (counter[channel] < 0) {
                counter[channel] += reg;
                outputBit[channel] ^= 1;
            }
            out[i + offset] += outputBit[channel] ? vol : -vol;
        }
    }

    var lfsr = 0;
    function shiftLfsrWhiteNoise() {
        var bit = (lfsr & 1) ^ ((lfsr & (1<<3)) >> 3);
        lfsr = (lfsr >> 1) | (bit << 15);
    }
    function shiftLfsrPeriodicNoise() {
        lfsr >>= 1;
        if (lfsr == 0) lfsr = 1<<15;
    }
    var shiftLfsr = shiftLfsrWhiteNoise;
    function noisePoked() {
        shiftLfsr = register[3] & 4 ? shiftLfsrWhiteNoise : shiftLfsrPeriodicNoise;
        lfsr = 1<<15;
    }

    function addFor(channel) {
        channel = +channel;
        switch (register[channel] & 3) {
        case 0: return 0x10;
        case 1: return 0x20;
        case 2: return 0x40;
        case 3: return register[channel - 1];
        }
    }

    function noiseChannel(channel, out, offset, length) {
        const add = addFor(channel), vol = volume[channel];;
        for (var i = 0; i < length; ++i) {
            counter[channel] -= sampleDecrement;
            if (counter[channel] < 0) {
                counter[channel] += add;
                outputBit[channel] ^= 1;
                if (outputBit[channel]) shiftLfsr();
            }
            out[i + offset] += (lfsr & 1) ? vol : -vol;
        }
    }

    var enabled = true;
    function generate(out, offset, length) {
        offset = +offset; length = +length;
        var i;
        for (i = 0; i < length; ++i) {
            out[i + offset] = 0.0;
        }
        if (!enabled) return;
        for (i = 0; i < 4; ++i) {
            generators[i](i, out, offset, length);
        }
        const scale = 1.0 / 4.0;
        for (i = 0; i < length; ++i) {
            out[i + offset] *= scale;
        }
    }

    var residual = 0;
    var position = 0;
    const maxBufferSize = 4096;
    var buffer = new Uint8Array(maxBufferSize);
    function render(out, offset, length) {
        const fromBuffer = position > length ? length : position;
        for (var i = 0; i < fromBuffer; ++i) {
            out[offset + i] = buffer[i];
        }
        offset += fromBuffer;
        length -= fromBuffer;
        for (i = fromBuffer; i < position; ++i) {
            buffer[i - fromBuffer] = buffer[i];
        }
        position -= fromBuffer;
        if (length !== 0) {
            generate(out, offset, length);
        }
    }

    function advance(time) {
        const num = time * sampleRate + residual;
        var rounded = num|0;
        residual = num - rounded;
        if (position + rounded >= maxBufferSize) {
            rounded = maxBufferSize - position;
            if (rounded === 0) return;
        }
        generate(buffer, position, rounded);
        position += rounded;
    }

    var latchedChannel = 0;
    function poke(value) {
        if ((value & 0x90) == 0x90) {
            // Volume setting
            var channel = (value >> 5) & 3;
            var newVolume = value & 0x0f;
            volume[channel] = volumeTable[newVolume];
        } else if ((value & 0x90) == 0x80) {
            latchedChannel = (value >> 5) & 3;
            register[latchedChannel] = (register[latchedChannel] & ~0x0f) | value & 0x0f;
            if (latchedChannel == 3) {
                noisePoked();
            }
        } else {
            register[latchedChannel] = (register[latchedChannel] & 0x0f) | ((value & 0x3f) << 4);
        }
    }

    for (var i = 0; i < 3; ++i) {
        generators[i] = toneChannel;
    }
    generators[3] = noiseChannel;

    this.advance = advance;
    this.render = render;
    this.poke = poke;
    this.enable = function(e) { enabled = e; }
    this.reset = function() {
        for (var i = 0; i < 3; ++i) {
            volume[i] = register[i] = 0;
        }
        noisePoked();
    }
}
