# Livorno address register

Source: [CASALP, *Patrimonio dicembre 2025* (ODS)](https://casalp.portaleamministrazionetrasparente.it/archiviofile/casalp/BENI_IMMOBILI_E_GESTIONE_PATRIMONIO/Patrimonio%20dicembre%202025.ods), downloaded 15 October 2026.

The spreadsheet lists individual property units. For this atlas, rows whose `localita` is `LIVORNO` and whose recorded category is `ALLOGGI ERP`, `ALLOGGI DI PROPRIETA CASALP`, `ALLOGGI NON ERP COMUNALI`, or `ALLOGGI COMUNALI A CANONE CONCORDATO` are grouped to a distinct civic address. The published register contains 6,141 such unit rows at 1,007 address strings.

`addresses.csv` is the reproducible, pre-geocoding transcription. `addresses.json` will contain only matches returned inside the Livorno study area; records that cannot be placed are retained in `addresses.problems.csv` locally for follow-up and are not published.
