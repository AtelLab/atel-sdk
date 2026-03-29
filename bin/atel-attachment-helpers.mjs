#!/usr/bin/env node
/**
 * Attachment CLI Helpers - Platform API Version
 * 
 * Helper functions for processing attachments in CLI commands.
 */

import { processImage, uploadAttachment } from '../dist/attachment/index.js';

/**
 * Parse attachment flags from command line arguments
 */
export function parseAttachmentFlags(args) {
  const images = [];
  const files = [];
  const audios = [];
  const videos = [];
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--image' && args[i + 1]) {
      images.push(args[i + 1]);
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      files.push(args[i + 1]);
      i++;
    } else if (args[i] === '--audio' && args[i + 1]) {
      audios.push(args[i + 1]);
      i++;
    } else if (args[i] === '--video' && args[i + 1]) {
      videos.push(args[i + 1]);
      i++;
    }
  }
  
  return { images, files, audios, videos };
}

/**
 * Process attachments for a task
 */
export async function processAttachments(attachmentFlags, uploadedBy, taskId) {
  const images = [];
  const attachments = [];
  
  // Process images
  for (const imagePath of attachmentFlags.images) {
    try {
      console.log(`Processing image: ${imagePath}...`);
      const result = await processImage(imagePath, {
        kind: 'image',
        uploadedBy,
        taskId,
      });
      images.push(result);
      
      if (result.kind === 'inline') {
        console.log(`  ✓ Inlined (${result.size} bytes)`);
      } else {
        console.log(`  ✓ Uploaded (${result.attachmentId})`);
      }
    } catch (error) {
      console.error(`  ✗ Failed: ${error.message}`);
      throw error;
    }
  }
  
  // Process files
  for (const filePath of attachmentFlags.files) {
    try {
      console.log(`Uploading file: ${filePath}...`);
      const result = await uploadAttachment(filePath, {
        kind: 'file',
        uploadedBy,
        taskId,
      });
      attachments.push(result);
      console.log(`  ✓ Uploaded (${result.attachmentId})`);
    } catch (error) {
      console.error(`  ✗ Failed: ${error.message}`);
      throw error;
    }
  }
  
  // Process audio
  for (const audioPath of attachmentFlags.audios) {
    try {
      console.log(`Uploading audio: ${audioPath}...`);
      const result = await uploadAttachment(audioPath, {
        kind: 'audio',
        uploadedBy,
        taskId,
      });
      attachments.push(result);
      console.log(`  ✓ Uploaded (${result.attachmentId})`);
    } catch (error) {
      console.error(`  ✗ Failed: ${error.message}`);
      throw error;
    }
  }
  
  // Process video
  for (const videoPath of attachmentFlags.videos) {
    try {
      console.log(`Uploading video: ${videoPath}...`);
      const result = await uploadAttachment(videoPath, {
        kind: 'video',
        uploadedBy,
        taskId,
      });
      attachments.push(result);
      console.log(`  ✓ Uploaded (${result.attachmentId})`);
    } catch (error) {
      console.error(`  ✗ Failed: ${error.message}`);
      throw error;
    }
  }
  
  return { images, attachments };
}

export { processImage, uploadAttachment };
