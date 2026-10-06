# 2octaver


## main idea

  This is a thing i vibe coded the hell out of for people like me(and presumably you) who wanna learn piano/keys, but have a measly shitty 2 octave keyboard and every other app assumes you have a lot more.


<img width="1895" height="1068" alt="image" src="https://github.com/user-attachments/assets/dbe6f927-6c58-4685-bab8-eae8e0c303b7" />

  Its a website you can host yourself,load midi, load audio,connect your midi keyboard and play along. The notes will automatically be adjusted to 2 octaves, and it will have the midi falling down on your keys like all those fancy youtube videos you see. You select the tracks you want to play and the site adjusts accordingly,like if you want to play lead guitar + bass or 2 synth tracks at once.




## Features 
  1. **Track selector:** play whatever tracks you want from your midi file (like left and right hand piano or bass and guitar)
  2. **Practice mode:** play note by note, the song will pause accordingly
  3. **Fingering help:** (NOT perfect, the point is to use more than 2 fingers, trust your gut if you feel like its wrong!)
  4. **Track slowdown:** stretches the audio too not just the midi.
  5. **Score system:** like in guitar pro and visuals and stats at the end for accuracy, including rhythm.
  6. **Audio quality:** scales with how well youre doing


## Usage

I will eventually get to adding a github.io link but currently,the only way to run it is with npm:

Install node.js.

Clone the repository:
```
git clone https://github.com/Christine1204/2octaver.git
cd 2octaver
```
Install dependencies:
```
npm install
```

Start the local Vite server:
```
npm run dev
```

Launch in browser: Open the printed local URL (usually http://localhost:5173/) in Google Chrome, Brave, or Edge(ew) or basically any browsers that support the Web MIDI API.



## Whats lacking right now

  Theres no internal sound,youll have to open a DAW or VST and play your own sounds,i reccomend any keys preset and a free synth like SurgeXT,but it depends on your goals
  Theres no way to turn the audio quality thing off yet, i should probably implement that
  Theres no way to select a specific midi controller if u have multiple,it just reads all of them
  There UI needs a big redesign to not look so vibe coded
  Scaling is a bit hard when its not fullscreen and fingering help is on
  Fingering help is not fully accurate to how convention goes
  I was planning on working on a drum mode too for the touch pads on midi controllers but thats not here yet


## Future

  I dont plan on working much on this at all since i have a bigger project that takes 95% of my attention,but you can freely contribute,with ai or not, as long as the change is sensible, even if i vibe coded this i try to keep the big structure intact and not let chaos ensue.

Cheers,Chr
  
