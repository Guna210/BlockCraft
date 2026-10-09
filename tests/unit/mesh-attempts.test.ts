import { describe, it, expect } from 'vitest';
import { MeshAttempts } from '../../src/world/mesh-attempts';

describe('MeshAttempts: an entry lives only while an attempt is open', () => {
  it('begin, upload and end return the sections the attempt uploaded and leave nothing behind', () => {
    const attempts = new MeshAttempts();
    attempts.begin('0,0');
    attempts.uploaded('0,0', '0,0,0');
    attempts.uploaded('0,0', '0,1,0');
    expect([...attempts.end('0,0')].sort()).toEqual(['0,0,0', '0,1,0']);
    expect(attempts.size).toBe(0);
  });

  it('an attempt discarded before its first upload is abandoned without leaving an empty entry', () => {
    // The M04a review found an empty Set left behind here, one per discarded attempt.
    const attempts = new MeshAttempts();
    attempts.begin('3,-4');
    expect(attempts.size).toBe(1);
    attempts.abandon('3,-4');
    expect(attempts.size).toBe(0);
  });

  it('an attempt discarded after some uploads forgets them too', () => {
    const attempts = new MeshAttempts();
    attempts.begin('0,0');
    attempts.uploaded('0,0', '0,0,0');
    attempts.abandon('0,0');
    expect(attempts.size).toBe(0);
    expect(attempts.end('0,0').size).toBe(0);
  });

  it('a later attempt starts with nothing of an abandoned or earlier one', () => {
    const attempts = new MeshAttempts();
    attempts.begin('0,0');
    attempts.uploaded('0,0', '0,0,0');
    attempts.begin('0,0');
    attempts.uploaded('0,0', '0,2,0');
    expect([...attempts.end('0,0')]).toEqual(['0,2,0']);
  });

  it('uploads with no open attempt are not recorded', () => {
    const attempts = new MeshAttempts();
    attempts.uploaded('5,5', '5,5,0');
    expect(attempts.size).toBe(0);
    expect(attempts.end('5,5').size).toBe(0);
  });

  it('ending a column with no open attempt changes nothing', () => {
    const attempts = new MeshAttempts();
    attempts.begin('1,1');
    expect(attempts.end('2,2').size).toBe(0);
    expect(attempts.size).toBe(1);
  });

  it('thousands of attempts that are all discarded leave no entries', () => {
    // A long flight: every column meshed and then discarded before its first upload.
    const attempts = new MeshAttempts();
    for (let cx = -40; cx < 40; cx++) {
      for (let cz = -40; cz < 40; cz++) {
        attempts.begin(`${cx},${cz}`);
        attempts.abandon(`${cx},${cz}`);
      }
    }
    expect(attempts.size).toBe(0);
  });

  it('clear forgets every open attempt', () => {
    const attempts = new MeshAttempts();
    attempts.begin('0,0');
    attempts.begin('1,0');
    attempts.clear();
    expect(attempts.size).toBe(0);
  });
});
