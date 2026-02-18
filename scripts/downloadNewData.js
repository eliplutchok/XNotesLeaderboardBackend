const https = require('https');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const downloadFile = (url, filePath) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filePath);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                fs.unlink(filePath, () => {});
                reject(new Error(`Failed to download ${url} (status ${response.statusCode})`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log(`Downloaded: ${filePath}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(filePath, () => {});
            reject(err.message);
        });
    });
};

const getCurrentDateInPST = () => {
    const options = { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const [month, day, year] = formatter.format(new Date()).split('/');
    return `${year}/${month}/${day}`;
};

const downloadAndExtractZip = async (url, tsvFolderPath) => {
    const zipFileName = url.split('/').pop();
    const zipFilePath = path.join(tsvFolderPath, zipFileName);

    await downloadFile(url, zipFilePath);

    const zip = new AdmZip(zipFilePath);
    zip.extractAllTo(tsvFolderPath, true);
    const extractedFiles = zip.getEntries().map(e => e.entryName);
    console.log(`Extracted: ${extractedFiles.join(', ')}`);

    fs.unlinkSync(zipFilePath);

    return extractedFiles;
};

const downloadNewData = async (tsvFolderPath, currentDate) => {
    try {
        if (!currentDate) {
            currentDate = getCurrentDateInPST();
        }

        const urls = [
            `https://ton.twimg.com/birdwatch-public-data/${currentDate}/notes/notes-00000.zip`,
            `https://ton.twimg.com/birdwatch-public-data/${currentDate}/notes/notes-00001.zip`,
            `https://ton.twimg.com/birdwatch-public-data/${currentDate}/noteStatusHistory/noteStatusHistory-00000.zip`
        ];

        const allExtracted = [];
        for (const url of urls) {
            const extracted = await downloadAndExtractZip(url, tsvFolderPath);
            allExtracted.push(...extracted);
        }

        console.log(`Download complete. Files: ${allExtracted.join(', ')}`);
        return allExtracted;
    } catch (error) {
        console.error('Error downloading files:', error);
        throw error;
    }
};

module.exports = downloadNewData;
