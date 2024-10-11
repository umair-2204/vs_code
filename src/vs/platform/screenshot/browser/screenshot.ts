/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { addDisposableListener, getActiveWindow } from '../../../base/browser/dom.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';

interface IBoundingBox {
	x: number;
	y: number;
	width: number;
	height: number;

	left: number;
	top: number;
	right: number;
	bottom: number;
}

class BoundingBox implements IBoundingBox {
	constructor(
		public readonly x: number,
		public readonly y: number,
		public readonly width: number,
		public readonly height: number,
	) { }

	get left() { return this.x; }
	get top() { return this.y; }
	get right() { return this.x + this.width; }
	get bottom() { return this.y + this.height; }
}


export async function generateFocusedWindowScreenshot(): Promise<ArrayBuffer | undefined> {
	try {
		const windowBounds = getActiveWindowBounds();
		if (!windowBounds) {
			return;
		}
		return takeScreenshotOfDisplay(windowBounds);
	} catch (err) {
		console.error('Error taking screenshot:', err);
		return undefined;
	}
}

async function takeScreenshotOfDisplay(cropDimensions?: IBoundingBox): Promise<ArrayBuffer | undefined> {
	const windowBounds = getActiveWindowBounds();
	if (!windowBounds) {
		return undefined;
	}
	try {
		// Create a video element to play the captured screen source
		const video = document.createElement('video');

		// TODO: This needs to get the stream for the actual window when strictly taking a
		//       screenshot of the window, so as to not leak windows in the foreground (eg. a always
		//       on top video)
		// Create a stream from the screen source (capture screen without audio)
		const stream = await navigator.mediaDevices.getDisplayMedia({
			audio: false,
			video: true
		});

		// Set the stream as the source of the video element
		video.srcObject = stream;
		video.play();

		// Wait for the video to load properly before capturing the screenshot
		const store = new DisposableStore();
		await Promise.all([
			new Promise<void>(r => store.add(addDisposableListener(video, 'loadedmetadata', () => r()))),
			new Promise<void>(r => store.add(addDisposableListener(video, 'canplaythrough', () => r())))
		]);
		store.dispose();

		// Create a canvas element with the size of the cropped region
		if (!cropDimensions) {
			cropDimensions = new BoundingBox(0, 0, video.videoWidth, video.videoHeight);
		}
		const canvas = document.createElement('canvas');
		canvas.width = cropDimensions.width;
		canvas.height = cropDimensions.height;

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return undefined;
		}

		// Draw the portion of the video (x, y) with the specified width and height
		ctx.drawImage(video,
			// Source
			cropDimensions.x, cropDimensions.y, cropDimensions.width, cropDimensions.height,
			// Dest
			0, 0, cropDimensions.width, cropDimensions.height,
		);

		// TODO: Move to finally
		// Stop the screen stream once the screenshot is taken
		stream.getTracks().forEach((track) => track.stop());

		// Convert the canvas to a Blob (PNG format)
		const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
		if (!blob) {
			throw new Error('Failed to create blob from canvas');
		}

		// Convert the Blob to an ArrayBuffer and then return it as a Uint8Array
		return blob.arrayBuffer();

	} catch (error) {
		console.error('Error taking screenshot:', error);
		return undefined;
	}
}

function getActiveWindowBounds(): IBoundingBox | undefined {
	const window = getActiveWindow();
	if (!window) {
		return;
	}
	const displayOffsetX = 'availLeft' in window.screen && typeof window.screen.availLeft === 'number' ? window.screen.availLeft : 0;
	const displayOffsetY = 'availTop' in window.screen && typeof window.screen.availTop === 'number' ? window.screen.availTop : 0;
	// This handling of dimensions is flaky, if the the active windoow is on the first monitor and
	// DPRs differ this may not work properly.
	return new BoundingBox(
		Math.round((window.screenX - displayOffsetX) * window.devicePixelRatio),
		Math.round((window.screenY - displayOffsetY) * window.devicePixelRatio),
		Math.round(window.innerWidth * window.devicePixelRatio),
		Math.round(window.innerHeight * window.devicePixelRatio),
	);
}

export interface IScreenShotContext {
	id: string;
	name: string;
	value: URI;
	isDynamic: boolean;
	isImage: true;
}
