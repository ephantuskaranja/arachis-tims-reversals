const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");

// Define file paths
const failedExcelPath = "Failed_Credit_Notes.xlsx"; // Path to the Excel file
const responsesFolder = "credit-note-responses"; // Folder containing credit note responses
const processedFilePath = "processed-credit-notes.json"; // JSON file containing processed filenames

// Function to read relevant numbers from Excel where errorDetails contain Pin Code Required (1500)
function getFailedRelevantNumbers() {
    const workbook = xlsx.readFile(failedExcelPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);

    return data
        .filter(row => row.errorDetails && row.errorDetails.trim() === `[{"property":"Pin code required!","errors":["1500"]}]`)
        .map(row => row.relevantNumber.toString().trim()); // Trim to remove spaces
}

// Function to remove failed credit notes from credit-note-responses folder and processed-credit-notes.json
function cleanFailedCreditNotes() {
    const failedNumbers = getFailedRelevantNumbers();
    if (failedNumbers.length === 0) {
        console.log("No failed credit notes found for Pin code required.");
        return;
    }

    // Remove files from credit-note-responses folder
    failedNumbers.forEach(relevantNumber => {
        const responseFilePath = path.join(responsesFolder, `error_${relevantNumber}.json`);
        if (fs.existsSync(responseFilePath)) {
            fs.unlinkSync(responseFilePath);
            console.log(`Deleted: ${responseFilePath}`);
        }
    });

    // Remove from processed-credit-notes.json
    if (fs.existsSync(processedFilePath)) {
        let processedNotes = JSON.parse(fs.readFileSync(processedFilePath, "utf8"));
        processedNotes = processedNotes.filter(file => {
            const cleanFileName = file.replace(".json", "").trim();
            return !failedNumbers.includes(cleanFileName);
        });

        fs.writeFileSync(processedFilePath, JSON.stringify(processedNotes, null, 2));
        console.log("Updated processed-credit-notes.json");
    }

    console.log("Cleanup complete!");
}

// Run the function
cleanFailedCreditNotes();
