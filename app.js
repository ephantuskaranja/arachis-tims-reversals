// Import necessary modules
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const XLSX = require('xlsx');

const app = express();
const PORT = 3000;

require('dotenv').config();

app.use(express.json());

// Ensure invoices and credit-notes folders exist
const invoicesDir = path.join(__dirname, 'invoices');
const creditNotesDir = path.join(__dirname, 'credit-notes');

if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir);
if (!fs.existsSync(creditNotesDir)) fs.mkdirSync(creditNotesDir);

// Custom HTTP agent to control connection behavior
const agent = new http.Agent({
    keepAlive: false
});

// Axios instance with extended timeout
const axiosInstance = axios.create({
    timeout: 10000,
});

// Function to verify PIN
async function verifyPin(deviceIP, pin) {
    const response = await axiosInstance.post(`http://${deviceIP}:8086/api/v3/pin`, pin, {
        headers: {
            'Content-Type': 'text/plain',
            'Accept': 'application/json'
        },
        httpAgent: agent
    });
    return response.data;
}

// Function to read processed numbers from file
function readProcessedNumbers() {
    const processedNumbersPath = path.join(__dirname, 'processedNumbers.json');
    if (fs.existsSync(processedNumbersPath)) {
        const processedNumbersData = fs.readFileSync(processedNumbersPath, 'utf8');
        try {
            return JSON.parse(processedNumbersData);
        } catch (error) {
            console.error('Error parsing processedNumbers.json:', error);
            return [];
        }
    }
    return [];
}

// Function to write processed number to file
function writeProcessedNumber(number) {
    const processedNumbersPath = path.join(__dirname, 'processedNumbers.json');
    const processedNumbers = readProcessedNumbers();
    processedNumbers.push(number);
    fs.writeFileSync(processedNumbersPath, JSON.stringify(processedNumbers, null, 2));
}

// Endpoint to verify pin and process response
app.get('/get-invoice-items', async (req, res) => {
    const pin = '0000';
    // const deviceIP = '100.100.2.151'; // live IP device
    const deviceIP = process.env.DEVICE_IP; // live IP device

    if (!pin) {
        return res.status(400).json({ error: 'Pin is required' });
    }

    try {
        // Read relevant numbers from JSON file
        const relevantNumbersPath = path.join(__dirname, 'relevantNumbers.json');
        if (!fs.existsSync(relevantNumbersPath)) {
            return res.status(400).json({ error: 'Relevant numbers file not found' });
        }

        const relevantNumbersData = fs.readFileSync(relevantNumbersPath, 'utf8');
        let relevantNumbers;
        try {
            relevantNumbers = JSON.parse(relevantNumbersData).numbers;
        } catch (error) {
            console.error('Error parsing relevantNumbers.json:', error);
            return res.status(400).json({ error: 'Error parsing relevant numbers file' });
        }

        if (!Array.isArray(relevantNumbers) || relevantNumbers.length === 0) {
            return res.status(400).json({ error: 'Relevant numbers is not a valid array or is empty' });
        }

        const processedNumbers = readProcessedNumbers();

        let verifyPinResponse = await verifyPin(deviceIP, pin);
        console.log('Initial pin verification response:', verifyPinResponse);

        if (verifyPinResponse !== '0100') {
            return res.status(400).json({ error: 'Invalid initial pin verification' });
        }

        for (const relevantNumber of relevantNumbers) {
            if (processedNumbers.includes(relevantNumber)) {
                console.log(`Skipping already processed number: ${relevantNumber}`);
                continue;
            }

            const getInvoiceItems = await axiosInstance.get(`http://${deviceIP}:8086/api/v3/transactions/${relevantNumber}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Connection': 'close'
                },
                httpAgent: agent
            });

            console.log(`Invoice items response: ${relevantNumber}`, getInvoiceItems.data);

            const data = getInvoiceItems.data;
            const fileName = `${relevantNumber}.json`;

            if (data.messages === 'Success' && Array.isArray(data.items) && data.items.length > 0) {
                const grandTotal = data.items.reduce((sum, item) => sum + item.totalAmount, 0);

                const creditNoteData = {
                    invoiceType: 0,
                    transactionType: 1,
                    cashier: "ADMIN",
                    items: data.items,
                    relevantNumber: relevantNumber,
                    payment: [{
                        amount: grandTotal,
                        paymentType: "Cash"
                    }]
                };

                fs.writeFileSync(path.join(invoicesDir, fileName), JSON.stringify(data, null, 2));
                fs.writeFileSync(path.join(creditNotesDir, fileName), JSON.stringify(creditNoteData, null, 2));
            } else if (data.messages === '1500') {
                verifyPinResponse = await verifyPin(deviceIP, pin);
                console.log('Re-verification pin response:', verifyPinResponse);

                if (verifyPinResponse !== '0100') {
                    return res.status(400).json({ error: 'Invalid pin re-verification' });
                }
            } else {
                console.log(`No items found or unsuccessful response for ${relevantNumber}`);
                fs.writeFileSync(path.join(invoicesDir, fileName), JSON.stringify({}, null, 2));
                fs.writeFileSync(path.join(creditNotesDir, fileName), JSON.stringify({}, null, 2));
            }

            writeProcessedNumber(relevantNumber);
        }

        return res.status(200).json({ message: 'Invoices and Credit Notes processed' });
    } catch (error) {
        if (error.code === 'ECONNRESET') {
            console.error('Connection was reset:', error.message);
        } else {
            console.error('Error processing request:', error.message);
        }
        res.status(500).json({ error: 'An error occurred while processing the request' });
    }
});

function convertExcelToJson() {
    try {
        const workbook = XLSX.readFile(path.join(__dirname, 'RelevantNumbers.xlsx'));
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const relevantNumbers = jsonData
            .map(row => row[0])
            .filter(val => val !== undefined && val !== null && String(val).trim() !== '');

        const output = { numbers: relevantNumbers };

        const outputPath = path.join(__dirname, 'relevantNumbers.json');
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

        console.log('JSON file generated successfully at:', outputPath);
    } catch (error) {
        console.error('Error converting Excel to JSON:', error);
    }
}

function findEmptyInvoices() {
    try {
        const emptyInvoices = [];

        // Read all files from the invoices directory
        const invoiceFiles = fs.readdirSync(invoicesDir);

        invoiceFiles.forEach(file => {
            const filePath = path.join(invoicesDir, file);
            const fileContent = fs.readFileSync(filePath, 'utf8');

            try {
                const data = JSON.parse(fileContent);

                // Check if the data is empty or missing items
                if (Object.keys(data).length === 0 || !data.items || data.items.length === 0) {
                    emptyInvoices.push(file.replace('.json', ''));
                }
            } catch (error) {
                console.error(`Error parsing JSON for file ${file}:`, error);
            }
        });

        // Save the result to a JSON file
        const outputPath = path.join(__dirname, 'emptyInvoices.json');
        fs.writeFileSync(outputPath, JSON.stringify({ emptyInvoices }, null, 2));

        console.log(`Empty invoices saved to ${outputPath}`);
    } catch (error) {
        console.error('Error finding empty invoices:', error);
    }
}

// findEmptyInvoices();

function removeEmptyFromProcessed() {
    try {
        const processedNumbersPath = path.join(__dirname, 'processedNumbers.json');
        const emptyInvoicesPath = path.join(__dirname, 'emptyInvoices.json');

        if (!fs.existsSync(processedNumbersPath) || !fs.existsSync(emptyInvoicesPath)) {
            console.error('❌ One or both files (processedNumbers.json, emptyInvoices.json) are missing.');
            return;
        }

        // Read and parse processed numbers
        let processedNumbers = JSON.parse(fs.readFileSync(processedNumbersPath, 'utf8')).map(num => String(num).trim());

        // Read and parse empty invoices
        const emptyInvoicesData = JSON.parse(fs.readFileSync(emptyInvoicesPath, 'utf8'));
        const emptyInvoices = emptyInvoicesData.emptyInvoices.map(num => String(num).trim());

        if (!Array.isArray(emptyInvoices)) {
            console.error('❌ Empty invoices data is not an array.');
            return;
        }

        // Filter out empty invoices from processed numbers
        const updatedProcessed = processedNumbers.filter(number => !emptyInvoices.includes(number));

        fs.writeFileSync(processedNumbersPath, JSON.stringify(updatedProcessed, null, 2));
        console.log('✅ Empty invoices have been successfully removed from processedNumbers.json');
    } catch (error) {
        console.error('❌ Error removing empty invoices:', error.message);
    }
}

//removeEmptyFromProcessed();

// Function to remove empty JSON files from a directory
function removeEmptyJsonFiles(directory) {
    fs.readdirSync(directory).forEach(file => {
        const filePath = path.join(directory, file);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            try {
                const jsonData = JSON.parse(content);
                if (Object.keys(jsonData).length === 0) {
                    fs.unlinkSync(filePath);
                    console.log(`Deleted empty file: ${filePath}`);
                }
            } catch (error) {
                console.error(`Error parsing JSON in file: ${filePath}`, error);
            }
        }
    });
}

// Execute the removal for both directories
// removeEmptyJsonFiles(invoicesDir);
// removeEmptyJsonFiles(creditNotesDir);

// console.log('Empty JSON files removal process completed.');

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
