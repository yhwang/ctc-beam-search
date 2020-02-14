import { EN_CHAR_MAP, EN_BLANK_INDEX } from './constants';

declare global {
  interface EmscriptenModule {
    addFunction?: Function;
    stringToUTF8?: Function;
    runtimeInitialized?: boolean;
  }

  namespace NodeJS {
    interface Global {
        Module?: EmscriptenModule;
    }
  }
}

/**
 * This class is used to represent the vocabulary for
 * the SpeechModel. It contains the valid characters
 * , index mapping and index of CTC blank
 *
 * @export
 * @class Vocabulary
 */
export class Vocabulary {
  readonly _charToIndex: {[key:string]: number};
  readonly _indexToChar: {[key:number]: string};
  readonly _blankIndex: number;

  /**
   * Creates an instance of Vocabulary by giving the char to index mapping table
   * as well as the CTC blank index
   * @param {{[key:string]: number}} charToIndex
   * @param {number} blankIndex
   * @memberof Vocabulary
   */
  constructor(charToIndex: {[key:string]: number}, blankIndex: number) {
    this._charToIndex = {};
    this._indexToChar = {};
    this._blankIndex = blankIndex;
    for( const [k, v] of Object.entries(charToIndex)) {
      this._charToIndex[k] = v;
      this._indexToChar[v] = k;
    }
  }
  /**
   * Get the char to index mapping table
   * @readonly
   * @memberof Vocabulary
   */
  get charToIndex() {
    return this._charToIndex;
  }

  /**
   * Get the index to char mapping table
   * @readonly
   * @memberof Vocabulary
   */
  get indexToChar() {
    return this._indexToChar;
  }

  /**
   * Get the CTC blank index
   * @readonly
   * @memberof Vocabulary
   */
  get blankIndex() {
    return this._blankIndex;
  }
}

// Vocabulary for English
export const EN_VOCABULARY: Vocabulary =
    new Vocabulary(EN_CHAR_MAP, EN_BLANK_INDEX);

// Add logarithmic probabilities using:
// ln(a + b) = ln(a) + ln(1 + exp(ln(b) - ln(a)))
const logSumExp = (log1: number, log2: number): number => {
  if (log1 === 0) {
    return log2;
  }
  if (log2 === 0) {
    return log1;
  }
  const rev = log1 > log2 ?
      log1 + Math.log1p(Math.exp(log2 - log1)):
      log2 + Math.log1p(Math.exp(log1 - log2));

  return rev;
};

/**
 * Represent char index sequence and the probability
 */
class BeamEntry {
  seq: number[];
  pTotal: number;
  pBlank: number;
  pNonBlank: number;
  _last: number;
  _string: string;
  _parent: BeamEntry;

  constructor(seq: number[], last?: number) {
    this.seq = seq;
    this.pTotal = 0;
    this.pBlank = 0;
    this.pNonBlank = 0;
    this._last = -1;
    if (last) {
      this._last = last;
    } else {
      this._calculateLast();
    }
  }

  _calculateLast() {
    if (this.seq.length > 0) {
      this._last = this.seq[this.seq.length - 1];
    }
  }

  // Convert char index sequence to a string
  convertToStr(vocabulary: Vocabulary): string {
    if(this._string === undefined) {
      this._string = this.seq.map((index) => {
        return vocabulary.indexToChar[index];
      }).join('');
    }
    return this._string;
  }

  /**
   * Handle the case the adding a new char doesn't change the string
   * of results. For example, if the current string is 'abc':
   * - 'abc' + 'c'  ==> 'abc'
   * - 'abc-' + '-' ==> 'abc'
   * - 'abc' + '-'  ==> 'abc'
   * For these cases, the string of new beam entry is the same but new
   * log probability. This function returns a new beam entry. 
   * 
   * @param {number[]} row
   * @param {number} blank
   * @returns
   * @memberof BeamEntry
   */
  copy(row: number[], blank: number) {
    if (this._last === -1) {
      // leading space case has no copy case
      return undefined;
    }
    const rev = new BeamEntry(this.seq, this._last);
    // blank probability only assigned in here
    // and it is used in the extend() case 3
    if (this._parent && this._parent._last === this._last) {
      // If current sequence is abb, then copy() can be:
      // 1. ab- + - ==> ab   (this.pBlank + blank)
      // 2. abb + - ==> ab   (this.pNonBlank + blank)
      // 3. abb + b ==> ab
      // Therefore, use this.pTotal + blank for #1 and #2
      rev.pBlank = this.pTotal + blank;
    } else {
      // if current sequence is acb, then copy() can be:
      // 1. acb + - ==> acb
      // 2. acb + b ==> acb
      // Therefore, use this.pNonBlank + blank for #1
      rev.pBlank = this.pNonBlank + blank;
    }
    rev.pNonBlank = this.pNonBlank + row[this._last];
    rev.pTotal = logSumExp(rev.pNonBlank, rev.pBlank);
    rev._parent = this;
    return rev;
  }

  /**
   * Handle the case that add a new char into the result. For example, if
   * the current beam entry is 'abc', you may have the following combinations
   * to extend the string:
   * - 'abc-' + 'c' ==> abcc
   * - 'abc'  + 'd' ==> abcd
   * Then a new Beam Entry contains the extract char is returned
   *
   * @param {number} index new char's index
   * @param {number} prob new char's log probability
   * @param {number} pBlank log probability of blank index
   * @returns {BeamEntry} a new BeamEntry to represent the new extended case
   * @memberof BeamEntry
   */
  extend(index: number, prob: number, pBlank: number)
      : BeamEntry {
    let pNewNonBlank = 0;
    let newSeq: number[] = [];
    let pNewTotal = 0;
    let newIndex = index;
    if (this._last === -1 && index === 0) {
      // case 1:
      // leading space: merge space and blank
      // '' + (' ' and blank) ==> but still ''
      pNewTotal = this.pTotal + logSumExp(prob, pBlank);
      newIndex = -1;
    } else if (index === this._last) {
      if (this.pBlank === 0) {
        // case 2:
        // not from copy() step and no record for the blank probability
        // no extend for this case.
        return undefined;
      } else {
        // case 3:
        // for those BeamEntries that derive from copy() step
        // the label is 'ab' but the pBlank store the probability for
        // 'ab-'. Therefore:
        // 'ab' ==> 'ab-' + 'b' ==> 'abb'
        pNewTotal = pNewNonBlank = this.pBlank + prob;
        newSeq = [...this.seq, index];
      }
    } else {
      // case 4:
      // 'ab' + 'c' ==> 'abc'
      pNewTotal = pNewNonBlank = this.pTotal + prob;
      newSeq = [...this.seq, index];
    }

    const rev = new BeamEntry(newSeq, newIndex);
    rev.pNonBlank = pNewNonBlank;
    rev.pTotal = pNewTotal;
    rev._parent = this;
    return rev;
  }

  // Dump string and prob
  toString(vocabulary: Vocabulary): string {
    return `${this.convertToStr(vocabulary)}, (${this.pTotal})`;
  }
}

/**
 * Store the cadidated BeamEntry
 *
 * @class BeamList
 */
class BeamList {
  _size: number;
  _beams: {[label:string]: BeamEntry};
  _beamList: BeamEntry[];

  constructor(size: number) {
    this._size = size;
    this._beamList = [];
    this._beams = {};
  }

  /**
   * Add a BeamEntry into the list. If the label sequence of
   * BeamEntry already exist in the list, its probabilities
   * will be merged into existing one. Otherwise, the BeamEntry
   * will be added to the list.
   *
   * @param {BeamEntry} beam new cadidate entry
   * @returns
   * @memberof BeamList
   */
  add(beam: BeamEntry, vocab: Vocabulary) {
    if (beam === undefined) {
      return;
    }
    const label = beam.convertToStr(vocab);
    const existing = this._beams[label];
    if (existing) {
      // merge probability
      existing.pBlank = logSumExp(beam.pBlank, existing.pBlank);
      existing.pNonBlank = logSumExp(beam.pNonBlank, existing.pNonBlank);
      existing.pTotal = logSumExp(beam.pTotal, existing.pTotal);
    } else {
      this._beams[label] = beam;
      this._beamList.push(beam);
    }
  }

  /**
   * Sort the BeamEntry in the list from high probability to low probability.
   * And the array length honors the beam width.
   *
   * @returns {BeamEntry[]}
   * @memberof BeamList
   */
  sort(): BeamEntry[] {
    const rev = this._beamList.sort((a: BeamEntry, b: BeamEntry) => {
      return b.pTotal - a.pTotal;
    });
    rev.length = this._size;
    return rev;
  }

  /**
   * Getter of beam width
   *
   * @readonly
   * @memberof BeamList
   */
  get size() {
    return this._size;
  }
}

/**
 * Use to run the CTC Beam Search
 */
export class CTCBeamSearch {
  readonly _vocabulary: Vocabulary;
  readonly _vocabSize: number;
  readonly _blankIndex: number;

  /**
   * Create the LanguageModel with specified trie
   * and vocabulary size.
   *
   * Note: it doesn't load the trie yet
   * @param {number} vocabSize label number
   * @param {BeamSearchOption} option trie path, ngram path and etc.
   */
  constructor(vocabulary: Vocabulary) {
    this._vocabulary = vocabulary;
    this._vocabSize = Object.keys(vocabulary.charToIndex).length;
    this._blankIndex = vocabulary.blankIndex;
  }

  /**
   * Run CTC decoding with language model
   * @param {number[][]} logProbs time serial log probabilities
   * @param {number} width beam width
   */
  search(logProbs: number[][], width: number): BeamEntry[] {
    let beams: BeamEntry[] = [
        new BeamEntry([])];

    // Walk over each time step in sequence
    logProbs.forEach((row) => {
      const allCandidates:BeamList = new BeamList(width);
      // Go through each BeamEntry in the candidate list
      beams.forEach((beam) => {
        // calculate copy() case
        // first time slot has no copy case
        // the logic inside copy() return undefined
        allCandidates.add(
            beam.copy(row, row[this._blankIndex]),
            this._vocabulary);
        // then run through all labels for the extend() case
        for(let cIndex = 0, len = row.length - 1; cIndex < len; cIndex++) {
          // extend cases
          allCandidates.add(
              beam.extend(cIndex, row[cIndex], row[this._blankIndex]),
              this._vocabulary);
        }
      });

      // Order all candidates by score
      beams = allCandidates.sort();
    });
    return beams;
  }

  /**
   * Getter of the Vocabulary of this
   * language model.
   * @readonly
   * @memberof CTCBeamSearch
   */
  get vocabulary() {
    return this._vocabulary;
  }
}
