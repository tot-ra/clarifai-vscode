import * as vscode from 'vscode';
import * as fs from 'fs';

// Extracted constants
const CLARIFAI_API_URL = "https://api.clarifai.com/v2/inputs";
const IMAGE_EXTENSIONS = ['jpeg', 'jpg', 'png', 'gif', 'bmp'];
const TEXT_EXTENSIONS = ['yml', 'yaml', 'py', 'go', 'js', 'ts'];

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
	

	const provider = new ColorsViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ColorsViewProvider.viewType, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand('calicoColors.addColor', () => {
			provider.addColor();
		}));

	context.subscriptions.push(
		vscode.commands.registerCommand('calicoColors.clearColors', () => {
			provider.clearColors();
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
						await processFolderRecursively(uri.fsPath);
					}
				});

				await Promise.all(folderPromises);
				vscode.window.showInformationMessage('Folders uploaded to Clarifai successfully.');
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to upload folders to Clarifai: ${error}`);
			}
		})
	);
}


class ColorsViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'calicoColors.colorsView';

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

	public addColor() {
		if (this._view) {
			this._view.show?.(true); // `show` is not implemented in 1.49 but is for 1.50 insiders
			this._view.webview.postMessage({ type: 'addColor' });
		}
	}

	public clearColors() {
		if (this._view) {
			this._view.webview.postMessage({ type: 'clearColors' });
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

				<title>Cat Colors</title>
			</head>
			<body>
				<ul class="color-list">
				</ul>

				<button class="add-color-button">Add Color</button>

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
};



async function readImagesContentsAndPostToClarifai(imagePaths: any, relFilePath: any) {
    const config = vscode.workspace.getConfiguration('clarifai-vscode');
    const pat = config.get('PAT');

    for (const imagePath of imagePaths) {
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
        }
    }
}

async function processFolderRecursively(folderPath: string) {
	const entries = fs.readdirSync(folderPath, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = `${folderPath}/${entry.name}`;
		if (entry.isDirectory()) {
			await processFolderRecursively(fullPath);
		} else if (entry.isFile()) {
			const ext = entry.name.split('.').pop()?.toLowerCase();
			if (ext && IMAGE_EXTENSIONS.includes(ext)) {
				await readImagesContentsAndPostToClarifai([fullPath], fullPath);
			} else if (ext && TEXT_EXTENSIONS.includes(ext)) {
				const textContent = fs.readFileSync(fullPath, 'utf-8');
				await sendTextToClarifai(fullPath, textContent);
			}
		}
	}
}