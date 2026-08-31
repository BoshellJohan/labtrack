import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ImportPreview } from '@labtrack/shared';
import { ImportComponent } from './import.component';
import { API_URL } from '../../../core/api/api.config';
import { IMPORT_ES } from './i18n.es';

function fileWithOneRow(): File {
  return new File(['irrelevant'], 'reactivos.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const previewFixture: ImportPreview = {
  verdicts: [
    {
      row: {
        rowNumber: 2,
        reagentName: 'Acetona',
        casNumber: '67-64-1',
        reference: 'REF-1',
        lotNumber: 'LOTE-1',
        entryDate: '2026-01-01',
        expirationDate: '2027-01-01',
        quantity: '5',
        unit: 'ML',
        locationName: 'Estante A1',
      },
      issues: [],
      reagent: { action: 'reuse', existingName: 'Acetona' },
      unit: 'ML',
      locationId: 'location-1',
    },
  ],
  summary: {
    totalRows: 1,
    invalidRows: 0,
    reagentsToCreate: 0,
    reagentsToReuse: 1,
  },
};

describe('ImportComponent', () => {
  let fixture: ComponentFixture<ImportComponent>;
  let component: ImportComponent;
  let http: HttpTestingController;

  function configure() {
    TestBed.configureTestingModule({
      imports: [ImportComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    fixture = TestBed.createComponent(ImportComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  }

  afterEach(() => http.verify());

  it('keeps the preview it was given and sends those exact rows on confirm', () => {
    configure();
    component.onFileSelected(fileWithOneRow());
    http
      .expectOne((r) => r.url === 'http://api.test/reagents/import/preview')
      .flush(previewFixture);

    component.confirm();

    const request = http.expectOne((r) => r.url === 'http://api.test/reagents/import/confirm');
    // What the user approved is what gets sent. Re-reading the file here would
    // let a swapped file be imported without anyone seeing it.
    expect(request.request.body.rows).toEqual(previewFixture.verdicts.map((v) => v.row));
    request.flush({ reagentsCreated: 0, batchesCreated: 1 });
  });

  it('does not allow confirming while any row is invalid', () => {
    configure();
    component.onFileSelected(fileWithOneRow());
    http.expectOne((r) => r.url === 'http://api.test/reagents/import/preview').flush({
      ...previewFixture,
      summary: { ...previewFixture.summary, invalidRows: 1 },
    });

    expect(component.canConfirm()).toBe(false);
    component.confirm();
    http.expectNone((r) => r.url === 'http://api.test/reagents/import/confirm');
  });

  it('shows, per row, whether a reagent will be created or reused', () => {
    configure();
    component.onFileSelected(fileWithOneRow());
    http
      .expectOne((r) => r.url === 'http://api.test/reagents/import/preview')
      .flush(previewFixture);
    fixture.detectChanges();

    // This column is the only thing that makes a near-duplicate visible before
    // it is written, so it is the one the test pins.
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(IMPORT_ES.willReuse);
  });

  it('renders the quantity together with its unit, never one without the other', () => {
    configure();
    component.onFileSelected(fileWithOneRow());
    http
      .expectOne((r) => r.url === 'http://api.test/reagents/import/preview')
      .flush(previewFixture);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('5');
    expect(text).toContain('mL');
  });

  it('renders a Spanish message for a row issue code, never the raw code', () => {
    configure();
    component.onFileSelected(fileWithOneRow());
    http.expectOne((r) => r.url === 'http://api.test/reagents/import/preview').flush({
      verdicts: [
        {
          ...previewFixture.verdicts[0],
          issues: [{ column: 'CAS', code: 'INVALID_CAS' }],
          reagent: null,
        },
      ],
      summary: { ...previewFixture.summary, invalidRows: 1, reagentsToReuse: 0 },
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(IMPORT_ES.issues.INVALID_CAS());
    expect(text).not.toContain('INVALID_CAS');
  });
});
