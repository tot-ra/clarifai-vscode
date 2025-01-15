import * as vscode from 'vscode';
import * as fs from 'fs';
import { EventEmitter } from 'events';

// Extracted constants
const CLARIFAI_API_URL = "https://api.clarifai.com/v2/inputs";
const IMAGE_EXTENSIONS = ['jpeg', 'jpg', 'png', 'gif', 'bmp'];
const TEXT_EXTENSIONS = ['yml', 'yaml', 'py', 'go', 'js', 'ts'];

class UploadQueue extends EventEmitter {
	private queue: string[] = [];

	add(filePath: string) {
		this.queue.push(filePath);
		this.emit('update', this.queue); // Emit the entire queue
	}

	remove(filePath: string) {
		this.queue = this.queue.filter(file => file !== filePath);
		this.emit('update', this.queue); // Emit the entire queue
	}

	getQueue() {
		return this.queue; // Return the entire queue
	}

	clear() {
		this.queue = [];
		this.emit('update', this.queue); // Emit the entire queue
	}
}

const uploadQueue = new UploadQueue();

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('clarifai-vscode.setApiToken', async () => {
		  const token = await vscode.window.showInputBox({ prompt: 'Enter your API token' });
		  if (token) {
			await context.secrets.store('clarifaiApiToken', token);
			vscode.window.showInformationMessage('API token saved successfully.');
		  }
		})
	  );
	

	const provider = new ClarifaiViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ClarifaiViewProvider.viewType, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand('clarifai.addColor', () => {
			provider.cancelUploads();
		}));

	context.subscriptions.push(
		vscode.commands.registerCommand('clarifai.addImageToClarifai', async (contextSelection: vscode.Uri, uris: vscode.Uri[]) => {
			try {
				for (const uri of uris) {
					// Convert the URI to a file path
					const imagePath = uri.fsPath;

					// Assume the title is derived from the image or context
					const relFilePath = vscode.workspace.asRelativePath(imagePath);

					// Call the function to process and send images to Clarifai
					await readImagesContentsAndPostToClarifai([imagePath], relFilePath);

					vscode.window.showInformationMessage(`Image ${relFilePath} sent to Clarifai successfully.`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to send images to Clarifai: ${error}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('clarifai.addTextToClarifai', async (contextSelection: vscode.Uri, uris: vscode.Uri[]) => {
			try {
				let textContent = '';
				let title = '';

				for (const uri of uris) {
					const filePath = uri.fsPath;
					textContent = fs.readFileSync(filePath, 'utf-8');
					title = vscode.workspace.asRelativePath(filePath);
					await sendTextToClarifai( 
						filePath, 
						textContent
					);
					vscode.window.showInformationMessage(`Text from ${title} sent to Clarifai successfully.`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to send text to Clarifai: ${error}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('clarifai.uploadFolderToClarifai', async (contextSelection: vscode.Uri, uris: vscode.Uri[]) => {
			try {
				const folderPromises = uris.map(async (uri) => {
					const stats = fs.statSync(uri.fsPath);
					if (stats.isDirectory()) {
						await traverseAndQueueFiles(uri.fsPath);
					}
				});

				await Promise.all(folderPromises);

				vscode.window.showInformationMessage('Folders uploaded to Clarifai successfully.');
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to upload folders to Clarifai: ${error}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('clarifai.clearColors', () => {
			provider.cancelUploads();
		})
	);

	uploadQueue.on('update', (queue) => {
		provider.updateQueue(queue);
	});

	// Start continuous processing of queued files
	processQueuedFilesContinuously().catch(error => {
		console.error('Error in continuous file processing:', error);
	});
}


class ClarifaiViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'clarifai.colorsView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'colorSelected':
					{
						vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(`#${data.value}`));
						break;
					}
			}
		});
	}

	public cancelUploads() {
		if (this._view) {
			uploadQueue.clear();
			vscode.window.showInformationMessage('All uploads canceled and queue cleared.');
		}
	}

	public updateQueue(queue: string[]) {
		if (this._view) {
			console.log(`Updating view with queue: ${queue.length} files`);
			this._view.webview.postMessage({ type: 'updateQueue', queue });
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

		// Do the same for the stylesheet.
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading styles from our extension directory,
					and only allow scripts that have a specific nonce.
					(See the 'webview-sample' extension sample for img-src content security policy examples)
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">
			</head>
			<body>

				<textarea id="rag" style="width: 400px; height: 300px;" placeholder="Explain this file"></textarea>
				<br/>
				<button>Search</button>
				
				<h1>Upload queue:${uploadQueue.getQueue().length}</h1>

				${uploadQueue.getQueue().length > 0 ? '<button class="cancel-uploads-button">Cancel uploads</button>' : ''}

				<div class="upload-queue" style="font-size: 10px;">
					${uploadQueue.getQueue().map(filePath => {
						// Convert the file path to a relative path before adding to the queue
						const relativeFilePath = vscode.workspace.asRelativePath(filePath);
						return `<div>${relativeFilePath}</div>`

					}).join('')}
				</div>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}



// Function to send data to Clarifai
async function sendTextToClarifai (filepath: any, text: any) {
	uploadQueue.add(filepath);
    const config = vscode.workspace.getConfiguration('clarifai-vscode');
    const userId = config.get('USER_ID');
    const appId = config.get('APP_ID');
    const pat = config.get('PAT');

	const id = require('crypto').createHash('md5').update(text).digest('hex');

    const raw = JSON.stringify({
        "user_app_id": {
            "user_id": userId,
            "app_id": appId
        },
        "inputs": [
            {
                id,
                "data": {
                    text: {
                        raw: text
                    },

                    metadata: {
                        filepath
                    }
                }
            }
        ]
    });

    const requestOptions = {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Authorization': 'Key ' + pat
        },
        body: raw
    };

    fetch(CLARIFAI_API_URL, requestOptions)
        .then(response => response.text())
        .then(result => console.log(result))
        .catch(error => console.log('error', error));

    // sleep 100ms to not overwhelm the API
    await new Promise(r => setTimeout(r, 100));

	uploadQueue.remove(filepath);
};



async function readImagesContentsAndPostToClarifai(imagePaths: any, relFilePath: any) {
	for (const imagePath of imagePaths) {
		uploadQueue.add(imagePath);
		const config = vscode.workspace.getConfiguration('clarifai-vscode');
		const pat = config.get('PAT');

		try {
			const raw: any = {
				"inputs": [
					{
						"data": {
							metadata: {
								"filepath": imagePath
							}
						}
					}
				],
			};

			const imageData = fs.readFileSync(imagePath, { encoding: 'base64' });

			const imageId = require('crypto').createHash('md5')
				.update(fs.readFileSync(imagePath))
				.digest('hex');

			raw.inputs[0].id = imageId; // Use imageId instead of docId
			raw.inputs[0].data.image = {
				base64: imageData
			};

			const requestOptions = {
				method: 'POST',
				headers: {
					'Accept': 'application/json',
					'Authorization': 'Key ' + pat
				},
				body: JSON.stringify(raw)
			};

			const response = await fetch(CLARIFAI_API_URL, requestOptions);
			const result = await response.json();

			// @ts-ignore
			vscode.window.showInformationMessage(result?.status?.details);
		} catch (error) {
			vscode.window.showErrorMessage(`Error processing ${relFilePath} : image ${imagePath} ${error}`);
		} finally {
			uploadQueue.remove(imagePath);
		}
	}
}

async function traverseAndQueueFiles(folderPath: string) {
	const entries = fs.readdirSync(folderPath, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = `${folderPath}/${entry.name}`;
		if (entry.isDirectory()) {
			await traverseAndQueueFiles(fullPath);
		} else if (entry.isFile()) {
			const ext = entry.name.split('.').pop()?.toLowerCase();
			if (ext && (IMAGE_EXTENSIONS.includes(ext) || TEXT_EXTENSIONS.includes(ext))) {
				// slow down the queue is too large
				if (uploadQueue.getQueue().length >= 100) {
					console.log('Queue size is 10 or more, pausing traversal...');
					await new Promise(resolve => setTimeout(resolve, 1000)); // Sleep for 5 seconds
				}

				uploadQueue.add(fullPath);
				console.log(`Added to queue: ${fullPath}`);
			}
		}
	}
}

async function processQueuedFilesContinuously() {
	while (true) {
		const queue = uploadQueue.getQueue();
		console.log(`Processing queue: ${queue.length} files`);

		for (const filePath of queue) {
			const ext = filePath.split('.').pop()?.toLowerCase();
			if (ext && IMAGE_EXTENSIONS.includes(ext)) {
				try {
					await readImagesContentsAndPostToClarifai([filePath], filePath);
				} catch (error) {
					console.error(`Failed to upload image ${filePath}: ${error}`);
				}
			} else if (ext && TEXT_EXTENSIONS.includes(ext)) {
				try {
					const textContent = fs.readFileSync(filePath, 'utf-8');
					await sendTextToClarifai(filePath, textContent);
				} catch (error) {
					console.error(`Failed to upload text ${filePath}: ${error}`);
				}
			} else {
				console.warn(`Unsupported file type for ${filePath}`);
			}
		}

		// Sleep for a short period before checking the queue again
		await new Promise(resolve => setTimeout(resolve, 2000)); // 5 seconds delay
	}
}