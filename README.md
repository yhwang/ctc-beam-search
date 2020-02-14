# beam-search
Implement the Connectionist Temporal Classification(CTC) beam search in
JavaScript. The input is log probabilities of an array. The length of the
array is the number of CTC slots. Each item in the array contains an array of
log probabilities to each characters, including blank character. Usually
the blank character is the last one. The implementation doesn't support NGram
now. But it's one of the todos.

## Usage
The following code is used to handle English CTC results:
``` javascript
const { CTCBeamSearch, EN_VOCABULARY } = require('ctc-beam-search');
const bs = new CTCBeamSearch(EN_VOCABULARY);
const data = ....; // log probabilities
const results = bs.search(data, 5); // beam width = 5
// dump the first result to console as a string
console.log(results[0].convertToStr(EN_VOCABULARY));
```

The `EN_VOCABULARY` is like this:
``` javascript
const { Vocabulary } = require('ctc-beam-search');
const engV = new Vocabulary({ ' ': 0,
                              'a': 1,
                              'b': 2,
                              'c': 3,
                              'd': 4,
                              'e': 5,
                              'f': 6,
                              'g': 7,
                              'h': 8,
                              'i': 9,
                              'j': 10,
                              'k': 11,
                              'l': 12,
                              'm': 13,
                              'n': 14,
                              'o': 15,
                              'p': 16,
                              'q': 17,
                              'r': 18,
                              's': 19,
                              't': 20,
                              'u': 21,
                              'v': 22,
                              'w': 23,
                              'x': 24,
                              'y': 25,
                              'z': 26,
                              '\'': 27,
                            }, 28);
```
You can create you own Vocabulary.