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

const BASE_URL = 'https://ton.twimg.com/birdwatch-public-data';

const fileUrl = (date, prefix, index) => {
    const padded = String(index).padStart(5, '0');
    return `${BASE_URL}/${date}/${prefix}/${prefix}-${padded}.zip`;
};

const headRequest = (url) => {
    return new Promise((resolve) => {
        https.request(url, { method: 'HEAD' }, (res) => {
            resolve(res.statusCode);
        }).on('error', () => resolve(0)).end();
    });
};

const subtractDays = (dateStr, days) => {
    const [year, month, day] = dateStr.split('/').map(Number);
    const d = new Date(year, month - 1, day);
    d.setDate(d.getDate() - days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${dd}`;
};

const discoverFiles = async (date, prefix) => {
    const urls = [];
    for (let i = 0; ; i++) {
        const url = fileUrl(date, prefix, i);
        const status = await headRequest(url);
        if (status !== 200) break;
        urls.push(url);
    }
    return urls;
};

const resolveLatestDate = async (maxDaysBack = 3) => {
    const today = getCurrentDateInPST();
    for (let i = 0; i <= maxDaysBack; i++) {
        const candidate = subtractDays(today, i);
        console.log(`Probing date ${candidate}...`);
        const status = await headRequest(fileUrl(candidate, 'notes', 0));
        if (status === 200) {
            console.log(`Found data for ${candidate}`);
            return candidate;
        }
        console.log(`  No data (HTTP ${status})`);
    }
    throw new Error(`No data found for the last ${maxDaysBack + 1} days starting from ${today}`);
};

const downloadNewData = async (tsvFolderPath, currentDate) => {
    try {
        if (!currentDate) {
            currentDate = await resolveLatestDate();
        }

        const noteUrls = await discoverFiles(currentDate, 'notes');
        const statusUrls = await discoverFiles(currentDate, 'noteStatusHistory');

        if (noteUrls.length === 0) throw new Error('No note files found for ' + currentDate);
        if (statusUrls.length === 0) throw new Error('No note status files found for ' + currentDate);

        console.log(`Found ${noteUrls.length} note file(s), ${statusUrls.length} status file(s)`);

        const noteFiles = [];
        const noteStatusFiles = [];

        for (const url of noteUrls) {
            const extracted = await downloadAndExtractZip(url, tsvFolderPath);
            noteFiles.push(...extracted.map(f => path.join(tsvFolderPath, f)));
        }

        for (const url of statusUrls) {
            const extracted = await downloadAndExtractZip(url, tsvFolderPath);
            noteStatusFiles.push(...extracted.map(f => path.join(tsvFolderPath, f)));
        }

        console.log(`Download complete. Notes: ${noteFiles.map(f => path.basename(f)).join(', ')}, Status: ${noteStatusFiles.map(f => path.basename(f)).join(', ')}`);
        return { noteFiles, noteStatusFiles };
    } catch (error) {
        console.error('Error downloading files:', error);
        throw error;
    }
};

module.exports = downloadNewData;
