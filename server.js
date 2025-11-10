/**
 * Generator adresacji IP i nastawni - backend Express
 * Funkcje:
 * - Upload pliku CSV i walidacja
 * - Podsumowanie elementów do adresacji
 * - Generowanie adresacji IP na podstawie CSV
 * - Obsługa konfiguracji LPR i nastawni
 * - Pobieranie pliku wynikowego
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generateAdresacja, summaryForCsv, hostsForMask, cidrToDecimal } = require('./adresacja-generator');

const upload = multer({ dest: 'uploads/' });
const app = express();
const PORT = 3000;

// Tworzenie wymaganych katalogów jeśli nie istnieją
['output', 'uploads'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

app.use(express.static('public'));
app.use(express.json());

/**
 * Endpoint: /summary
 * Opis: Przyjmuje plik CSV, waliduje go (rozszerzenie + nagłówek), zwraca podsumowanie wierszy
 */
app.post('/summary', upload.single('file'), (req, res) => {
    try {
        const inputCsvPath = req.file.path;
        const originalName = req.file.originalname;
        
        // Walidacja pliku CSV: rozszerzenie, nagłówek
        const validation = validateCsv(inputCsvPath, originalName);
        if (!validation.valid) {
            fs.unlinkSync(inputCsvPath);
            return res.status(400).json({ error: validation.msg });
        }
        
        // Generowanie podsumowania elementów do tabeli
        const summary = summaryForCsv(inputCsvPath);
        res.json({ summary, fileId: req.file.filename });
    } catch (err) {
        console.error('Summary error:', err);
        res.status(500).json({ error: 'Błąd przetwarzania pliku!' });
    }
});

/**
 * Endpoint: /generate
 * Opis: Generuje adresację IP na podstawie pliku CSV, zwraca dane podsieci i wynikowe wiersze
 * Obsługuje również konfigurację LPR i nastawni
 */
app.post('/generate', express.json(), async (req, res) => {
    try {
        const { fileId, lprEnabled, redLightEnabled } = req.body;
        const inputCsvPath = path.join('uploads', fileId);
        
        if (!fs.existsSync(inputCsvPath)) {
            return res.status(400).json({ error: 'Plik nie istnieje' });
        }
        
        const dataJsonPath = path.resolve('DATA.json');
        const outputDir = path.resolve('output');
        
        // Wywołanie funkcji generującej adresację z konfiguracją LPR
        const result = await generateAdresacja(inputCsvPath, dataJsonPath, outputDir, {
            lprEnabled,
            redLightEnabled
        });

        // Usuwanie pliku tymczasowego
        fs.unlinkSync(inputCsvPath);

        // Wyliczanie parametrów podsieci: liczba użytych, zapas, maska dziesiętna
        const used = result.rows.filter(r => r['Adres ip V4'] !== 'DHCP').length;
        const total = hostsForMask(result.mask);
        const reserve = total - used;
        
        res.json({
            ...result,
            used,
            reserve,
            subnetMask: cidrToDecimal(result.mask),
            prefix: result.network + "/" + result.mask
        });
    } catch (err) {
        console.error('Generate error:', err);
        res.status(500).json({ error: 'Błąd generacji adresacji: ' + err.message });
    }
});

/**
 * Endpoint: /download/:fileName
 * Opis: Pozwala pobrać wygenerowany plik CSV z adresacją
 */
app.get('/download/:fileName', (req, res) => {
    const fileName = req.params.fileName;
    const outputFilePath = path.join('output', fileName);
    if (!fs.existsSync(outputFilePath)) {
        return res.status(404).send('Plik nie istnieje');
    }
    res.download(outputFilePath, fileName);
});

/**
 * Funkcja walidująca plik CSV
 * Sprawdza:
 * - Czy rozszerzenie jest .csv (wg oryginalnej nazwy)
 * - Czy nagłówek jest zgodny z regułami (dowolna odmiana "Ilość" oraz BOM)
 */
function validateCsv(filePath, originalName) {
    // Sprawdzenie rozszerzenia pliku
    if (!originalName.toLowerCase().endsWith('.csv')) {
        return { valid: false, msg: 'Plik musi mieć rozszerzenie .csv' };
    }
    
    // Pobranie i sprawdzenie nagłówka
    const content = fs.readFileSync(filePath, 'utf8');
    const firstLine = content.split(/[\r\n]+/)[0].replace(/^\uFEFF/, '').trim();
    const expectedHeaders = [
        ['Nazwa Obiektu','Kategoria','Nazwa','Ilość','Klasa'],
        ['Nazwa Obiektu','Kategoria','Nazwa','Ilosc','Klasa'],
        ['Nazwa Obiektu','Kategoria','Nazwa','ilość','Klasa'],
    ];
    const actualHeaders = firstLine.split(';').map(h => h.trim());
    
    if (!expectedHeaders.some(
        exp => exp.every((h, i) => (actualHeaders[i] || '').toLowerCase() === h.toLowerCase())
    )) {
        return { valid: false, msg: 'Nieprawidłowy nagłówek pliku CSV!' };
    }
    
    return { valid: true };
}

app.listen(PORT, () => {
    console.log(`Serwer działa na http://localhost:${PORT}`);
    console.log('Generator adresacji IP i nastawni gotowy do użycia');
});