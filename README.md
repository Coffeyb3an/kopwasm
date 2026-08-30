## KOPWASM
Koppen - Weather Atmospheric Sound Machine.

An interactive, web-based generative audio synthesizer built with the Web Audio API. The application maps real time meteorological data or manually configured weather parameters into generative musical textures and atmospheric soundscapes.

## Overview

This project retrieves live weather observations from the Open-Meteo API (or location coordinates via OpenStreetMap Nominatim) and translates meteorological parameters (Temperature, Humidity, Rain, Cloud Cover, Wind, and Solar Radiation) into real time synthesised audio.

### Features
- Live Weather Sonification: Maps live weather metrics to synthesis parameters.
- Browser Native Synthesis: Built using Web Audio nodes, custom oscillators, filters, noise generators, and a sample accurate clock scheduler.
- Background Playback: Configured with page visibility and wake lock handlers to enable playback when switching tabs or running inside nested iframe elements.
- Preset & Favorite Management: Save and reload customised weather soundscapes using local storage.
- Realtime WAV Exporter: In browser audio recording pipeline that encodes raw PCM WAV binary data for file download.

## Sound Architecture & Weather Mapping

| Weather Parameter | Audio Mapping | Technical Implementation |

- Sun: Bell/Chime pitch selection and trigger frequency - Sine oscillator with exponential envelope decay 
- Wind: Filter cutoff frequency and resonance - Bandpass filtered white noise buffer 
- Rain: Tempo (BPM), hi-hat frequency, and kick drum triggers - Sample-accurate ScriptProcessorNode clock scheduler 
- Cloud: Harmonic drone density and frequency - Lowpass filtered multi-triangle chord oscillators 
- Humidity: Arpeggio scale density, octave shifts, and decay - Square/Triangle oscillator with dynamic decay curves 
- Temperature: Sub-bass frequency foundation - Lowpass filtered sub-bass sine oscillator 

## Getting Started

1. Clone the repository:
   git clone https://github.com/coffeyb3an/kopwasm.git

2. Launch the application:
   Open Terminal in your project folder and run:
   python3 -m http.server 8000
   
   Then open http://localhost:8000 in your browser.

## Tech Stack

- Frontend: HTML5, CSS3
- Audio Engine: Web Audio API (AudioContext, BiquadFilterNode, GainNode, OscillatorNode, ScriptProcessorNode)
- APIs: Open-Meteo Forecast API, OpenStreetMap Nominatim Geocoding API
- Web APIs: Screen Wake Lock API, Media Session API, MediaRecorder API

## License

This project is licensed under the MIT License.
