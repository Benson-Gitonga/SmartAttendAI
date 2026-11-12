import { reasonsLine } from './RiskExplanation';

describe('reasonsLine', () => {
  it('says nothing when the student has no marked absences', () => {
    expect(reasonsLine({ marked: 0 })).toBeNull();
    expect(reasonsLine(undefined)).toBeNull();
  });

  it('lists the reasons and says they count', () => {
    const line = reasonsLine({ marked: 10, fee: 3, health: 2, other: 3, notGiven: 2, coverage: 0.8, used: true });
    expect(line).toBe('Absence reasons, last 4 weeks (10 absences): 3 for fees, 2 sick, 3 other, 2 not given. These count towards the score.');
  });

  it('explains when too few reasons were given to count', () => {
    const line = reasonsLine({ marked: 5, fee: 1, health: 0, other: 1, notGiven: 3, coverage: 0.4, used: false });
    expect(line).toBe('Absence reasons, last 4 weeks (5 absences): 1 for fees, 1 other, 3 not given. Not counted in the score: a reason was given for 40% of absences, and at least 70% is needed.');
  });
});
