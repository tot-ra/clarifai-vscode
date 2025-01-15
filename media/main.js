const vscode = acquireVsCodeApi();

window.addEventListener('message', event => {
	const message = event.data;
	switch (message.type) {
		case 'updateQueue':
			const queueList = document.querySelector('.upload-queue');
			queueList.innerHTML = ''; // Clear the list
			message.queue.forEach(file => {
				const listItem = document.createElement('div');
				listItem.textContent = file;
				queueList.appendChild(listItem);
			});

			// Update the h1 element with the new queue length
			const queueLengthElement = document.querySelector('h1');
			queueLengthElement.textContent = message.queue.length;

			// Show or hide the cancel button based on the queue length
			const cancelButton = document.querySelector('.cancel-uploads-button');
			if (message.queue.length > 0) {
				cancelButton.style.display = 'block';
			} else {
				cancelButton.style.display = 'none';
			}
			break;
		case 'displayResponse':
			// Update the responseText div with the response
			document.getElementById('responseText').textContent = message.response;
			break;
		// existing cases...
	}
}); 

document.querySelector('.cancel-uploads-button').addEventListener('click', () => {
	vscode.postMessage({
		type: 'cancelUploads'
	});
}); 

// Add event listener for the search button
document.querySelector('button').addEventListener('click', () => {
	const textarea = document.getElementById('rag');
	const rawText = textarea.value;

	// Send the rawText to the extension
	vscode.postMessage({
		type: 'searchClarifai',
		rawText: rawText
	});
}); 