import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import logger from '../../utils/logger.js';
import { TaskQueue } from '../../core/queue.js';

const execAsync = promisify(exec);

// Global conversion queue with concurrency 1 to prevent OOM
const conversionQueue = new TaskQueue(1);

/**
 * Convert Office document (doc, docx, ppt, pptx, xls, xlsx, odt) to PDF using LibreOffice.
 * Queued to prevent out-of-memory errors on 1GB RAM instances.
 * @param inputPath Path to the input file
 * @param outputDir Directory where the PDF should be saved
 * @returns The path to the generated PDF
 */
export async function convertOfficeToPdf(inputPath: string, outputDir: string): Promise<string> {
    return conversionQueue.enqueue(async () => {
        logger.info(`Starting Office to PDF conversion for ${path.basename(inputPath)}`);
        
        // Ensure output dir exists
        await fs.mkdir(outputDir, { recursive: true });

        // Build command: --headless --convert-to pdf --outdir <dir> <file>
        // Use timeout to prevent hanging
        const command = `timeout 120s libreoffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`;
        
        try {
            await execAsync(command);
            
            // LibreOffice creates a file with the same base name but .pdf extension
            const parsedPath = path.parse(inputPath);
            const outputFilePath = path.join(outputDir, `${parsedPath.name}.pdf`);
            
            // Verify the file was created
            await fs.access(outputFilePath);
            return outputFilePath;
        } catch (err: any) {
            logger.error({ err, command }, 'Failed to convert office document');
            throw new Error(`Failed to convert document: ${err.message}`);
        }
    });
}

/**
 * Compress a PDF using Ghostscript.
 * @param inputPath Input PDF path
 * @param outputPath Output PDF path
 * @param level Compression level: 'low' (max compression), 'medium', or 'high' (best quality)
 */
export async function compressPdf(inputPath: string, outputPath: string, level: 'low' | 'medium' | 'high' = 'low'): Promise<void> {
    return conversionQueue.enqueue(async () => {
        logger.info(`Starting PDF compression for ${path.basename(inputPath)} at level ${level}`);
        
        const settingsMap = {
            'low': '/screen',
            'medium': '/ebook',
            'high': '/printer'
        };
        const setting = settingsMap[level] || '/screen';

        // Ghostscript command
        const command = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=${setting} -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;
        
        try {
            await execAsync(command);
            // Verify file exists
            await fs.access(outputPath);
        } catch (err: any) {
            logger.error({ err, command }, 'Failed to compress PDF');
            throw new Error(`Failed to compress PDF: ${err.message}`);
        }
    });
}

/**
 * Convert images to a single PDF using ImageMagick (convert).
 * @param inputPaths Array of input image paths
 * @param outputPath Output PDF path
 */
export async function convertImagesToPdf(inputPaths: string[], outputPath: string): Promise<void> {
    return conversionQueue.enqueue(async () => {
        logger.info(`Starting Image to PDF conversion for ${inputPaths.length} images`);
        
        const inputFilesStr = inputPaths.map(p => `"${p}"`).join(' ');
        
        // We use -auto-orient to fix rotation, and -page A4 to normalize size loosely, but default usually works fine.
        const command = `convert ${inputFilesStr} "${outputPath}"`;
        
        try {
            await execAsync(command);
            await fs.access(outputPath);
        } catch (err: any) {
            logger.error({ err, command }, 'Failed to convert images to PDF');
            throw new Error(`Failed to convert images to PDF: ${err.message}`);
        }
    });
}
