const fs = require('fs').promises;

async function deleteFile(filePath) {
    try {
        await fs.unlink(filePath);
        console.log('File deleted successfully');
    } catch (err) {
        console.error('Error deleting the file:', err);
    }
}

module.exports = deleteFile;
