import { parseCsv, studentsFromCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields with commas and escaped quotes', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  });

  it('reads semicolon files and skips blank lines', () => {
    expect(parseCsv('Name;Adm\n\nAmina;1\n')).toEqual([['Name', 'Adm'], ['Amina', '1']]);
  });
});

describe('studentsFromCsv', () => {
  it('maps the usual headings and fixes phone numbers Excel mangled', () => {
    const { students, problems } = studentsFromCsv(
      '\uFEFFStudent Name,ADM NO,Parent Phone\nAmina Hassan,KB/1,712345678\nBrian  Otieno,KB/2,254722000111\n'
    );
    expect(problems).toEqual([]);
    expect(students).toEqual([
      { fullName: 'Amina Hassan', admissionNo: 'KB/1', guardianPhone: '0712345678' },
      { fullName: 'Brian Otieno', admissionNo: 'KB/2', guardianPhone: '+254722000111' },
    ]);
  });

  it('reports bad rows by their spreadsheet row number', () => {
    const { students, problems } = studentsFromCsv('Name,Phone\nAmina,0712345678\n,0712345678\nBrian,123\n');
    expect(students).toHaveLength(1);
    expect(problems).toEqual(['Row 3: no name.', 'Row 4: "123" is not a Kenyan mobile number.']);
  });

  it('needs a name column', () => {
    expect(studentsFromCsv('Adm,Phone\n1,0712345678\n').problems[0]).toMatch(/Name/);
  });
});
