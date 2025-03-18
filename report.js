function generateExcelReport() {
    const responsesDir = path.join(__dirname, 'credit-note-responses');
    const successFile = path.join(__dirname, 'Successful_Credit_Notes.xlsx');
    const failedFile = path.join(__dirname, 'Failed_Credit_Notes.xlsx');

    const successData = [];
    const failedData = [];

    fs.readdirSync(responsesDir).forEach(file => {
        const filePath = path.join(responsesDir, file);
        const content = fs.readFileSync(filePath, 'utf8');

        try {
            const jsonData = JSON.parse(content);

            if (file.startsWith('error_')) {
                // Extract relevant number from filename
                const relevantNumber = file.replace('error_', '').replace('.json', '');

                failedData.push({
                    relevantNumber,
                    errorMessage: jsonData.message,
                    errorDetails: jsonData.modelState ? JSON.stringify(jsonData.modelState) : ''
                });
            } else {
                // Store successful credit note details
                successData.push({
                    DateTime: jsonData.DateTime,
                    invoiceExtension: jsonData.invoiceExtension,
                    relevantNumber: jsonData.relevantNumber,
                    mtn: jsonData.mtn,
                    verificationUrl: jsonData.verificationUrl,
                    messages: jsonData.messages,
                    totalAmount: jsonData.totalAmount,
                    msn: jsonData.msn
                });
            }
        } catch (error) {
            console.error(`Error parsing JSON in file: ${filePath}`, error);
        }
    });

    // Convert to worksheets
    const successSheet = XLSX.utils.json_to_sheet(successData);
    const failedSheet = XLSX.utils.json_to_sheet(failedData);

    // Create workbooks
    const successWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(successWorkbook, successSheet, 'Successful Credit Notes');
    XLSX.writeFile(successWorkbook, successFile);

    const failedWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(failedWorkbook, failedSheet, 'Failed Credit Notes');
    XLSX.writeFile(failedWorkbook, failedFile);

    console.log('✅ Excel reports generated successfully!');
}

// Run the function
generateExcelReport();