import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SAMPLE_RATE = 48_000
const TAU = Math.PI * 2
const OUTPUT_DIRECTORY = fileURLToPath(
  new URL('../src/assets/audio/', import.meta.url),
)

const NOTE_OFFSETS = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

const noteFrequency = (note) => {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(note)
  if (!match) throw new Error(`Invalid note: ${note}`)

  const [, name, accidental, octaveText] = match
  const accidentalOffset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  const midi = (Number(octaveText) + 1) * 12 + NOTE_OFFSETS[name] + accidentalOffset
  return 440 * 2 ** ((midi - 69) / 12)
}

const equalPowerPan = (pan) => {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4
  return [Math.cos(angle), Math.sin(angle)]
}

const smoothstep = (value) => value * value * (3 - 2 * value)

const sustainedEnvelope = (time, gateSeconds, attackSeconds, releaseSeconds) => {
  if (time < attackSeconds) return smoothstep(time / attackSeconds)
  if (time <= gateSeconds) return 1
  return smoothstep(Math.max(0, 1 - (time - gateSeconds) / releaseSeconds))
}

const terminalFade = (time, durationSeconds, fadeSeconds = 0.12) =>
  smoothstep(Math.min(1, Math.max(0, (durationSeconds - time) / fadeSeconds)))

const addWarmPadNote = (track, note, startBeat, gateBeats, gain, pan) => {
  const frequency = noteFrequency(note)
  const start = Math.round(startBeat * track.samplesPerBeat)
  const gateSeconds = gateBeats * track.secondsPerBeat
  const attackSeconds = 1.8
  const releaseSeconds = 3.2
  const sampleCount = Math.ceil((gateSeconds + releaseSeconds) * SAMPLE_RATE)
  const [leftGain, rightGain] = equalPowerPan(pan)
  const leftFrequency = frequency * 2 ** (-5.5 / 1_200)
  const rightFrequency = frequency * 2 ** (5.5 / 1_200)

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const time = offset / SAMPLE_RATE
    const envelope = sustainedEnvelope(time, gateSeconds, attackSeconds, releaseSeconds)
    const shimmer = 0.975 + 0.025 * Math.sin(TAU * 0.045 * time)
    const leftWave =
      0.82 * Math.sin(TAU * leftFrequency * time) +
      0.18 * Math.sin(TAU * leftFrequency * 2 * time + 0.46)
    const rightWave =
      0.82 * Math.sin(TAU * rightFrequency * time + 0.16) +
      0.18 * Math.sin(TAU * rightFrequency * 2 * time + 0.94)
    const index = (start + offset) % track.sampleCount
    track.left[index] += leftWave * envelope * shimmer * gain * leftGain
    track.right[index] += rightWave * envelope * shimmer * gain * rightGain
  }
}

const addHollowPadNote = (track, note, startBeat, gateBeats, gain, pan) => {
  const frequency = noteFrequency(note)
  const start = Math.round(startBeat * track.samplesPerBeat)
  const gateSeconds = gateBeats * track.secondsPerBeat
  const attackSeconds = 1.1
  const releaseSeconds = 2.6
  const sampleCount = Math.ceil((gateSeconds + releaseSeconds) * SAMPLE_RATE)
  const [leftGain, rightGain] = equalPowerPan(pan)
  const leftFrequency = frequency * 2 ** (-1.2 / 1_200)
  const rightFrequency = frequency * 2 ** (1.2 / 1_200)

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const time = offset / SAMPLE_RATE
    const envelope = sustainedEnvelope(time, gateSeconds, attackSeconds, releaseSeconds)
    const drift = 0.99 + 0.01 * Math.sin(TAU * 0.07 * time + pan)
    const leftWave =
      0.93 * Math.sin(TAU * leftFrequency * time) +
      0.07 * Math.sin(TAU * leftFrequency * 2 * time + 0.3)
    const rightWave =
      0.93 * Math.sin(TAU * rightFrequency * time + 0.08) +
      0.07 * Math.sin(TAU * rightFrequency * 2 * time + 0.7)
    const index = (start + offset) % track.sampleCount
    track.left[index] += leftWave * envelope * drift * gain * leftGain
    track.right[index] += rightWave * envelope * drift * gain * rightGain
  }
}

const addDarkPadNote = (track, note, startBeat, gateBeats, gain, pan) => {
  const frequency = noteFrequency(note)
  const start = Math.round(startBeat * track.samplesPerBeat)
  const gateSeconds = gateBeats * track.secondsPerBeat
  const attackSeconds = 2.4
  const releaseSeconds = 4
  const sampleCount = Math.ceil((gateSeconds + releaseSeconds) * SAMPLE_RATE)
  const [leftGain, rightGain] = equalPowerPan(pan)
  const leftFrequency = frequency * 2 ** (-0.8 / 1_200)
  const rightFrequency = frequency * 2 ** (0.8 / 1_200)

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const time = offset / SAMPLE_RATE
    const envelope = sustainedEnvelope(time, gateSeconds, attackSeconds, releaseSeconds)
    const drift = 0.965 + 0.035 * Math.sin(TAU * 0.033 * time + 0.4)
    const leftWave =
      0.86 * Math.sin(TAU * leftFrequency * time) +
      0.11 * Math.sin(TAU * leftFrequency * 3 * time + 0.54) +
      0.03 * Math.sin(TAU * leftFrequency * 5 * time + 0.2)
    const rightWave =
      0.86 * Math.sin(TAU * rightFrequency * time + 0.1) +
      0.11 * Math.sin(TAU * rightFrequency * 3 * time + 0.88) +
      0.03 * Math.sin(TAU * rightFrequency * 5 * time + 0.7)
    const index = (start + offset) % track.sampleCount
    track.left[index] += leftWave * envelope * drift * gain * leftGain
    track.right[index] += rightWave * envelope * drift * gain * rightGain
  }
}

const addMoonDroplet = (track, note, startBeat, gain, pan) => {
  const frequency = noteFrequency(note)
  const start = Math.round(startBeat * track.samplesPerBeat)
  const durationSeconds = 4.8
  const attackSeconds = 0.025
  const decaySeconds = 1.05
  const sampleCount = Math.ceil(durationSeconds * SAMPLE_RATE)
  const [leftGain, rightGain] = equalPowerPan(pan)

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const time = offset / SAMPLE_RATE
    const attack = smoothstep(Math.min(1, time / attackSeconds))
    const envelope =
      attack * Math.exp(-time / decaySeconds) * terminalFade(time, durationSeconds)
    const phase = TAU * frequency * time
    const wave =
      0.86 * Math.sin(phase) +
      0.1 * Math.exp(-time / 0.8) * Math.sin(phase * 2 + 0.3) +
      0.04 * Math.exp(-time / 0.35) * Math.sin(phase * 3)
    const index = (start + offset) % track.sampleCount
    const sample = wave * envelope * gain
    track.left[index] += sample * leftGain
    track.right[index] += sample * rightGain
  }
}

const addIceBell = (track, note, startBeat, gain, pan, fmIndex) => {
  const frequency = noteFrequency(note)
  const start = Math.round(startBeat * track.samplesPerBeat)
  const durationSeconds = 6.2
  const attackSeconds = 0.014
  const decaySeconds = 1.2
  const sampleCount = Math.ceil(durationSeconds * SAMPLE_RATE)
  const [leftGain, rightGain] = equalPowerPan(pan)

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const time = offset / SAMPLE_RATE
    const attack = smoothstep(Math.min(1, time / attackSeconds))
    const envelope =
      attack * Math.exp(-time / decaySeconds) * terminalFade(time, durationSeconds)
    const phase = TAU * frequency * time
    const modulation = fmIndex * Math.exp(-time / 0.24) * Math.sin(phase * 2)
    const wave =
      0.93 * Math.sin(phase + modulation) +
      0.055 * Math.exp(-time / 0.52) * Math.sin(phase * 2 + 0.2) +
      0.038 * Math.exp(-time / 0.2) * Math.sin(phase * 4 + 0.6)
    const index = (start + offset) % track.sampleCount
    const sample = wave * envelope * gain
    track.left[index] += sample * leftGain
    track.right[index] += sample * rightGain
  }
}

const addBeaconChirp = (track, note, startBeat, gain, pan) => {
  const frequency = noteFrequency(note)
  const start = Math.round(startBeat * track.samplesPerBeat)
  const durationSeconds = 4.8
  const attackSeconds = 0.018
  const decaySeconds = 0.9
  const bendRatio = 2 ** (35 / 1_200) - 1
  const bendTime = 0.09
  const sampleCount = Math.ceil(durationSeconds * SAMPLE_RATE)
  const [leftGain, rightGain] = equalPowerPan(pan)

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const time = offset / SAMPLE_RATE
    const attack = smoothstep(Math.min(1, time / attackSeconds))
    const envelope =
      attack * Math.exp(-time / decaySeconds) * terminalFade(time, durationSeconds)
    const bentTime = time + bendRatio * bendTime * (1 - Math.exp(-time / bendTime))
    const phase = TAU * frequency * bentTime
    const wave =
      0.86 * Math.sin(phase) +
      0.14 * Math.exp(-time / 0.32) * Math.sin(phase * 3 + 0.4)
    const index = (start + offset) % track.sampleCount
    const sample = wave * envelope * gain
    track.left[index] += sample * leftGain
    track.right[index] += sample * rightGain
  }
}

const addWarmPulse = (track, note, startBeat, gain, pan) => {
  const frequency = noteFrequency(note)
  const start = Math.round(startBeat * track.samplesPerBeat)
  const durationSeconds = 4.2
  const attackSeconds = 0.045
  const decaySeconds = 0.85
  const sampleCount = Math.ceil(durationSeconds * SAMPLE_RATE)
  const [leftGain, rightGain] = equalPowerPan(pan)

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const time = offset / SAMPLE_RATE
    const attack = smoothstep(Math.min(1, time / attackSeconds))
    const envelope =
      attack * Math.exp(-time / decaySeconds) * terminalFade(time, durationSeconds, 0.09)
    const phase = TAU * frequency * time
    const sample =
      (0.86 * Math.sin(phase) +
        0.11 * Math.sin(phase * 2 + 0.3) +
        0.03 * Math.sin(phase * 3 + 0.7)) *
      envelope *
      gain
    const index = (start + offset) % track.sampleCount
    track.left[index] += sample * leftGain
    track.right[index] += sample * rightGain
  }
}

const addBowlPulse = (track, note, startBeat, gain, pan) => {
  const frequency = noteFrequency(note)
  const start = Math.round(startBeat * track.samplesPerBeat)
  const durationSeconds = 3.8
  const attackSeconds = 0.028
  const decaySeconds = 0.52
  const sampleCount = Math.ceil(durationSeconds * SAMPLE_RATE)
  const [leftGain, rightGain] = equalPowerPan(pan)

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const time = offset / SAMPLE_RATE
    const attack = smoothstep(Math.min(1, time / attackSeconds))
    const envelope =
      attack * Math.exp(-time / decaySeconds) * terminalFade(time, durationSeconds, 0.09)
    const phase = TAU * frequency * time
    const sample =
      (0.9 * Math.sin(phase) +
        0.08 * Math.exp(-time / 0.24) * Math.sin(phase * 2 + 0.22) +
        0.02 * Math.exp(-time / 0.12) * Math.sin(phase * 3 + 0.55)) *
      envelope *
      gain
    const index = (start + offset) % track.sampleCount
    track.left[index] += sample * leftGain
    track.right[index] += sample * rightGain
  }
}

const addSignalPulse = (track, note, startBeat, gain, pan) => {
  const frequency = noteFrequency(note)
  const start = Math.round(startBeat * track.samplesPerBeat)
  const durationSeconds = 4.1
  const attackSeconds = 0.025
  const decaySeconds = 0.9
  const sampleCount = Math.ceil(durationSeconds * SAMPLE_RATE)
  const [leftGain, rightGain] = equalPowerPan(pan)

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const time = offset / SAMPLE_RATE
    const attack = smoothstep(Math.min(1, time / attackSeconds))
    const envelope =
      attack * Math.exp(-time / decaySeconds) * terminalFade(time, durationSeconds, 0.09)
    const phase = TAU * frequency * time
    const sample =
      (0.91 * Math.sin(phase) +
        0.07 * Math.sin(phase * 2 + 0.2) +
        0.02 * Math.sin(phase * 4 + 0.8)) *
      envelope *
      gain
    const index = (start + offset) % track.sampleCount
    track.left[index] += sample * leftGain
    track.right[index] += sample * rightGain
  }
}

const createBus = (track) => ({
  ...track,
  left: new Float32Array(track.sampleCount),
  right: new Float32Array(track.sampleCount),
})

const addCrossDelay = (track, taps) => {
  const dryLeft = track.left.slice()
  const dryRight = track.right.slice()

  for (const [delaySeconds, gain] of taps) {
    const delay = Math.round(delaySeconds * SAMPLE_RATE)
    for (let index = 0; index < track.sampleCount; index += 1) {
      const source = (index - delay + track.sampleCount) % track.sampleCount
      track.left[index] += dryRight[source] * gain
      track.right[index] += dryLeft[source] * gain
    }
  }
}

const mixBus = (track, bus, gain = 1) => {
  for (let index = 0; index < track.sampleCount; index += 1) {
    track.left[index] += bus.left[index] * gain
    track.right[index] += bus.right[index] * gain
  }
}

const conditionMix = (track) => {
  const drive = track.drive ?? 1.04
  const targetRms = track.targetRms ?? 0.08
  let leftMean = 0
  let rightMean = 0
  for (let index = 0; index < track.sampleCount; index += 1) {
    leftMean += track.left[index]
    rightMean += track.right[index]
  }
  leftMean /= track.sampleCount
  rightMean /= track.sampleCount

  let peak = 0
  let energy = 0
  for (let index = 0; index < track.sampleCount; index += 1) {
    const left = Math.tanh((track.left[index] - leftMean) * drive)
    const right = Math.tanh((track.right[index] - rightMean) * drive)
    track.left[index] = left
    track.right[index] = right
    peak = Math.max(peak, Math.abs(left), Math.abs(right))
    energy += left * left + right * right
  }

  const rms = Math.sqrt(energy / (track.sampleCount * 2))
  const scale = Math.min(0.82 / peak, targetRms / rms)
  for (let index = 0; index < track.sampleCount; index += 1) {
    track.left[index] *= scale
    track.right[index] *= scale
  }

  return {
    peak: peak * scale,
    rms: rms * scale,
  }
}

const createTrack = (definition) => {
  const secondsPerBeat = 60 / definition.bpm
  const sampleCount = Math.round(definition.beats * secondsPerBeat * SAMPLE_RATE)
  return {
    ...definition,
    secondsPerBeat,
    samplesPerBeat: secondsPerBeat * SAMPLE_RATE,
    sampleCount,
    left: new Float32Array(sampleCount),
    right: new Float32Array(sampleCount),
  }
}

const writeWave = (path, track) => {
  const dataBytes = track.sampleCount * 2 * 2
  const output = Buffer.allocUnsafe(44 + dataBytes)
  output.write('RIFF', 0)
  output.writeUInt32LE(36 + dataBytes, 4)
  output.write('WAVE', 8)
  output.write('fmt ', 12)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(2, 22)
  output.writeUInt32LE(SAMPLE_RATE, 24)
  output.writeUInt32LE(SAMPLE_RATE * 4, 28)
  output.writeUInt16LE(4, 32)
  output.writeUInt16LE(16, 34)
  output.write('data', 36)
  output.writeUInt32LE(dataBytes, 40)

  let cursor = 44
  for (let index = 0; index < track.sampleCount; index += 1) {
    const left = Math.max(-1, Math.min(1, track.left[index]))
    const right = Math.max(-1, Math.min(1, track.right[index]))
    output.writeInt16LE(Math.round(left * 32_767), cursor)
    output.writeInt16LE(Math.round(right * 32_767), cursor + 2)
    cursor += 4
  }
  writeFileSync(path, output)
}

const renderLunarDrift = () => {
  const track = createTrack({
    filename: 'lunar-drift.ogg',
    title: 'Lunar Drift',
    bpm: 60,
    beats: 80,
    drive: 1.02,
    targetRms: 0.085,
  })
  const leadBus = createBus(track)
  const counterBus = createBus(track)
  const bars = [
    { pad: ['D3', 'A3', 'C#4', 'E4', 'F#4'], bass: ['D2', 'A2'], lead: [null, null, null] },
    { pad: ['D3', 'G3', 'B3', 'E4'], bass: ['D2', 'G2'], lead: ['A4', 'D5', 'E5'] },
    { pad: ['D3', 'A3', 'C#4', 'E4', 'F#4'], bass: ['D2', 'A2'], lead: ['A4', 'D5', 'F#5'] },
    { pad: ['A2', 'E3', 'B3', 'E4'], bass: ['A1', 'E2'], lead: ['E5', 'B4', 'C#5'] },
    { pad: ['D3', 'A3', 'C#4', 'E4', 'F#4'], bass: ['D2', 'A2'], lead: ['A4', 'D5', 'F#5'] },
    { pad: ['B2', 'F#3', 'A3', 'C#4', 'E4'], bass: ['B1', 'F#2'], lead: ['F#4', 'B4', 'C#5'] },
    { pad: ['G2', 'D3', 'F#3', 'A3', 'B3'], bass: ['G1', 'D2'], lead: ['D5', 'G5', 'B5'] },
    { pad: ['A2', 'E3', 'F#3', 'B3'], bass: ['A1', 'E2'], lead: ['E5', 'B4', 'C#5'] },
    { pad: ['F#2', 'C#3', 'E3', 'A3', 'B3'], bass: ['F#1', 'C#2'], lead: ['C#5', 'A4', 'B4'] },
    { pad: ['B2', 'F#3', 'A3', 'C#4', 'D4'], bass: ['B1', 'F#2'], lead: ['D5', 'C#5', 'A4'] },
    { pad: ['E3', 'B3', 'D4', 'F#4', 'G4'], bass: ['E2', 'B2'], lead: ['B4', 'G4', 'F#5'] },
    { pad: ['A2', 'E3', 'G3', 'B3', 'D4'], bass: ['A1', 'E2'], lead: ['E5', 'D5', 'B4'] },
    { pad: ['B2', 'F#3', 'A3', 'C#4', 'D4'], bass: ['B1', 'F#2'], lead: ['F#5', 'B5', 'A5'] },
    { pad: ['G2', 'D3', 'F#3', 'A3', 'B3'], bass: ['G1', 'D2'], lead: ['G5', 'D5', 'B4'] },
    { pad: ['F#2', 'A3', 'C#4', 'D4', 'E4'], bass: ['F#1', 'A2'], lead: ['A4', 'D5', 'F#5'] },
    { pad: ['A2', 'E3', 'F#3', 'B3', 'C#4'], bass: ['A1', 'E2'], lead: ['E5', 'C#5', 'B4'] },
    { pad: ['G2', 'D3', 'F#3', 'A3', 'B3'], bass: ['G1', 'D2'], lead: ['D5', 'B4', 'A4'] },
    { pad: ['A2', 'E3', 'F#3', 'B3', 'C#4'], bass: ['A1', 'E2'], lead: ['E5', 'C#5', 'B4'] },
    { pad: ['F#2', 'A3', 'C#4', 'D4', 'E4'], bass: ['F#1', 'A2'], lead: ['A4', 'D5', 'F#5'] },
    { pad: ['D3', 'A3', 'B3', 'E4', 'F#4'], bass: ['D2', 'A2'], lead: ['A4', 'E5', 'D5'] },
  ]
  const sectionGains = [0.55, 0.78, 0.9, 1, 0.52]
  const leadOffsets = [0, 4 / 3, 8 / 3]

  bars.forEach((bar, barIndex) => {
    const startBeat = barIndex * 4
    const sectionGain = sectionGains[Math.floor(barIndex / 4)]
    const foundationGain = 0.72 + 0.28 * sectionGain
    bar.bass.forEach((note, index) => {
      addWarmPadNote(
        track,
        note,
        startBeat,
        3.35,
        [0.034, 0.022][index] * foundationGain,
        [-0.08, 0.08][index],
      )
    })
    if (barIndex > 0) {
      const counterNotes = [bar.pad[1], bar.pad.at(-2)]
      counterNotes.forEach((note, index) => {
        addWarmPulse(
          counterBus,
          note,
          startBeat + [0, 2][index],
          [0.057, 0.047][index] * sectionGain,
          [-0.2, -0.16][index],
        )
      })
    }
    bar.lead.forEach((note, index) => {
      if (!note) return
      addMoonDroplet(
        leadBus,
        note,
        startBeat + leadOffsets[index],
        0.061 * sectionGain * [1, 0.78, 0.9][index],
        [0.16, 0.22, 0.18][index],
      )
    })
  })
  addCrossDelay(counterBus, [[0.063, 0.018]])
  addCrossDelay(leadBus, [[0.19, 0.055], [0.37, 0.038], [0.71, 0.022]])
  mixBus(track, counterBus)
  mixBus(track, leadBus)
  return track
}

const renderCraterGlass = () => {
  const track = createTrack({
    filename: 'crater-glass.ogg',
    title: 'Crater Glass',
    bpm: 57.6,
    beats: 72,
    drive: 1.06,
    targetRms: 0.087,
  })
  const leadBus = createBus(track)
  const counterBus = createBus(track)
  const cells = [
    { pad: ['E3', 'B3', 'D4', 'F#4', 'G4'], bass: ['E2', 'B2', 'D3'], lead: ['B4', 'E5', 'F#5', 'D5'] },
    { pad: ['E3', 'A3', 'C#4', 'D4', 'F#4'], bass: ['E2', 'A2', 'D3'], lead: ['B4', 'E5', 'F#5', 'D5'] },
    { pad: ['E3', 'A3', 'C#4', 'F#4', 'A4'], bass: ['E2', 'A2', 'C#3'], lead: ['B4', 'F#5', 'E5', 'C#5'] },
    { pad: ['C3', 'G3', 'B3', 'E4', 'F#4'], bass: ['C2', 'G2', 'B2'], lead: ['A4', 'D5', 'E5', 'C5'] },
    { pad: ['B2', 'F#3', 'A3', 'C#4', 'D4', 'E4'], bass: ['B1', 'F#2', 'A2'], lead: ['F#4', 'B4', 'D5', 'A4'] },
    { pad: ['A2', 'E3', 'F#3', 'B3', 'C#4'], bass: ['A1', 'E2', 'F#2'], lead: ['E4', 'A4', 'C#5', 'B4'] },
    { pad: ['G2', 'D3', 'F#3', 'A3', 'B3'], bass: ['G1', 'D2', 'A2'], lead: ['G4', 'B4', 'D5', 'F#5'] },
    { pad: ['F#2', 'A3', 'C#4', 'D4', 'E4'], bass: ['F#1', 'A2', 'D3'], lead: ['A4', 'D5', 'F#5', 'E5'] },
    { pad: ['A2', 'E3', 'B3', 'C#4', 'E4'], bass: ['A1', 'E2', 'B2'], lead: ['C#5', 'E5', 'A5', 'F#5'] },
    { pad: ['E3', 'G3', 'B3', 'C4', 'F#4'], bass: ['E2', 'C3', 'G2'], lead: ['C5', 'B4', 'F#5', 'E5'] },
    { pad: ['E3', 'A3', 'B3', 'D4', 'F#4'], bass: ['E2', 'B2', 'D3'], lead: ['B4', 'D5', 'F#5', 'A4'] },
    { pad: ['E3', 'B3', 'D4', 'F#4', 'G4'], bass: ['E2', 'B2', 'E3'], lead: ['B4', 'E5', 'F#5', 'D5'] },
  ]
  const cellGains = [0.5, 0.62, 0.75, 0.82, 0.9, 0.96, 1, 1.05, 1.1, 0.88, 0.72, 0.58]
  const fmIndices = [0.28, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.72, 0.58, 0.44, 0.32]
  const leadOffsets = [0, 1.5, 3, 4.5]
  const counterOffsets = [0, 2, 4]
  const leadAccents = [1, 0.6, 0.84, 0.56]
  const counterAccents = [1, 0.58, 0.72]

  cells.forEach((cell, cellIndex) => {
    const startBeat = cellIndex * 6
    const cellGain = cellGains[cellIndex]
    const foundationGain = 0.72 + 0.28 * cellGain
    cell.bass.slice(0, 2).forEach((note, index) => {
      addHollowPadNote(
        track,
        note,
        startBeat,
        5.25,
        [0.03, 0.019][index] * foundationGain,
        [-0.06, 0.06][index],
      )
    })
    cell.lead.forEach((note, index) => {
      if (!note) return
      const accent = leadAccents[index]
      addIceBell(
        leadBus,
        note,
        startBeat + leadOffsets[index],
        0.046 * cellGain * accent,
        [0.18, 0.24, 0.2, 0.16][index],
        fmIndices[cellIndex],
      )
    })
    const counterNotes = [cell.pad[1], cell.pad[2], cell.pad.at(-2)]
    counterNotes.forEach((note, index) => {
      addBowlPulse(
        counterBus,
        note,
        startBeat + counterOffsets[index],
        0.05 * cellGain * counterAccents[index],
        [-0.22, -0.17, -0.2][index],
      )
    })
  })
  addCrossDelay(counterBus, [[0.053, 0.022]])
  addCrossDelay(leadBus, [[0.071, 0.045], [0.149, 0.024]])
  mixBus(track, counterBus)
  mixBus(track, leadBus)
  return track
}

const renderFarSideSignals = () => {
  const track = createTrack({
    filename: 'far-side-signals.ogg',
    title: 'Far-side Signals',
    bpm: 50,
    beats: 64,
    drive: 1.08,
    targetRms: 0.088,
  })
  const leadBus = createBus(track)
  const counterBus = createBus(track)
  const cells = [
    {
      pad: ['C#3', 'G#3', 'B3', 'D#4', 'E4'],
      bass: ['C#2', 'G#2', 'C#3', 'G#2'],
      lead: ['G#4', 'C#5', 'E5', 'B4', 'D#5'],
    },
    {
      pad: ['B2', 'G#3', 'C#4', 'D#4', 'E4'],
      bass: ['B1', 'F#2', 'B2', 'G#2'],
      lead: ['G#4', 'C#5', 'E5', 'B4', 'F#5'],
    },
    {
      pad: ['A2', 'E3', 'G#3', 'B3', 'C#4'],
      bass: ['A1', 'E2', 'A2', 'E2'],
      lead: ['E5', 'B4', 'C#5', 'G#4', 'A4'],
    },
    {
      pad: ['B2', 'E3', 'G#3', 'D#4', 'F#4'],
      bass: ['B1', 'E2', 'B2', 'G#2'],
      lead: ['B4', 'E5', 'G#5', 'D#5', 'F#5'],
    },
    {
      pad: ['F#2', 'C#3', 'E3', 'A3', 'B3'],
      bass: ['F#1', 'C#2', 'F#2', 'A2'],
      lead: ['A4', 'C#5', 'F#5', 'E5', 'B4'],
    },
    {
      pad: ['A2', 'D3', 'F#3', 'G#3', 'C#4'],
      bass: ['A1', 'D2', 'A2', 'G#2'],
      lead: ['A4', 'D5', 'F#5', 'C#5', 'G#5'],
    },
    {
      pad: ['G#2', 'D#3', 'F#3', 'A3', 'C#4'],
      bass: ['G#1', 'D#2', 'G#2', 'A2'],
      lead: ['G#4', 'D#5', 'F#5', 'C5', 'A4'],
    },
    {
      pad: ['C#3', 'G#3', 'A#3', 'D#4', 'E4'],
      bass: ['C#2', 'G#2', 'C#3', 'G#2'],
      lead: ['G#4', 'C#5', 'E5', 'D#5', 'G#4'],
    },
  ]
  const cellGains = [0.45, 0.58, 0.7, 0.82, 0.92, 1, 0.8, 0.47]
  const leadOffsets = [0, 1.6, 3.2, 4.8, 6.4]
  const counterOffsets = [0, 2, 4, 6]
  const leadAccents = [1, 0.56, 0.76, 0.62, 0.88]
  const counterAccents = [1, 0.62, 0.82, 0.56]

  cells.forEach((cell, cellIndex) => {
    const startBeat = cellIndex * 8
    const cellGain = cellGains[cellIndex]
    const foundationGain = 0.72 + 0.28 * cellGain
    cell.bass.slice(0, 2).forEach((note, index) => {
      addDarkPadNote(
        track,
        note,
        startBeat,
        7.2,
        [0.03, 0.018][index] * foundationGain,
        [-0.04, 0.04][index],
      )
    })
    cell.lead.forEach((note, index) => {
      if (!note) return
      const globalEvent = cellIndex * leadOffsets.length + index
      const pan = 0.2 + Math.sin((globalEvent / (cells.length * leadOffsets.length - 1)) * TAU) * 0.035
      addBeaconChirp(
        leadBus,
        note,
        startBeat + leadOffsets[index],
        0.066 * cellGain * leadAccents[index],
        pan,
      )
    })
    const counterNotes = cell.pad.slice(1)
    counterNotes.forEach((note, index) => {
      addSignalPulse(
        counterBus,
        note,
        startBeat + counterOffsets[index],
        0.058 * cellGain * counterAccents[index],
        [-0.2, -0.16, -0.22, -0.18][index],
      )
    })
  })
  addCrossDelay(counterBus, [[0.071, 0.02]])
  addCrossDelay(leadBus, [[0.37, 0.08], [0.83, 0.045], [1.51, 0.025]])
  mixBus(track, counterBus)
  mixBus(track, leadBus)
  return track
}

const encodeVorbis = (wavePath, outputPath, title) => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      wavePath,
      '-map_metadata',
      '-1',
      '-metadata',
      `title=${title}`,
      '-metadata',
      'artist=PlayLearnAI',
      '-c:a',
      'libvorbis',
      '-q:a',
      '3',
      '-ar',
      String(SAMPLE_RATE),
      outputPath,
    ],
    { encoding: 'utf8' },
  )

  if (result.error) {
    throw new Error(`Could not run ffmpeg: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${title}: ${result.stderr.trim()}`)
  }
}

const encodeMp3 = (wavePath, outputPath, title) => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      wavePath,
      '-map_metadata',
      '-1',
      '-metadata',
      `title=${title}`,
      '-metadata',
      'artist=PlayLearnAI',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      String(SAMPLE_RATE),
      outputPath,
    ],
    { encoding: 'utf8' },
  )

  if (result.error) {
    throw new Error(`Could not run ffmpeg: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${title} MP3: ${result.stderr.trim()}`)
  }
}

const renderers = [renderLunarDrift, renderCraterGlass, renderFarSideSignals]
mkdirSync(OUTPUT_DIRECTORY, { recursive: true })
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'playlearnai-bgm-'))

try {
  for (const render of renderers) {
    const track = render()
    const levels = conditionMix(track)
    const wavePath = join(temporaryDirectory, track.filename.replace(/\.ogg$/, '.wav'))
    const outputPath = join(OUTPUT_DIRECTORY, track.filename)
    const mp3Path = join(OUTPUT_DIRECTORY, track.filename.replace(/\.ogg$/, '.mp3'))
    writeWave(wavePath, track)
    encodeVorbis(wavePath, outputPath, track.title)
    encodeMp3(wavePath, mp3Path, track.title)
    const duration = track.sampleCount / SAMPLE_RATE
    console.log(
      `${track.filename} + ${track.filename.replace(/\.ogg$/, '.mp3')}: ` +
      `${duration.toFixed(3)}s, peak ${levels.peak.toFixed(3)}, RMS ${levels.rms.toFixed(3)}`,
    )
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
