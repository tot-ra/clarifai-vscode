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
			// Hide the dots and stop the animation
			clearInterval(dotInterval);
			dots.style.display = 'none';

			// Update the responseText div with the response
			document.getElementById('responseText').innerHTML = message.response;
			break;
		// existing cases...
	}
}); 

// document.querySelector('.cancel-uploads-button').addEventListener('click', () => {
// 	vscode.postMessage({
// 		type: 'cancelUploads'
// 	});
// }); 

// Add a dots element to the HTML
const dots = document.createElement('div');
dots.className = 'dots';
dots.style.display = 'none'; // Hide the dots by default
document.body.appendChild(dots);

let dotInterval;

// Add event listener for the search button
document.getElementById('searchButton').addEventListener('click', () => {
	const textarea = document.getElementById('rag');
	const rawText = textarea.value;

	// Show the dots
	dots.style.display = 'block';

	// Start the dots animation
	let dotCount = 0;
	dotInterval = setInterval(() => {
		dotCount = (dotCount + 1) % 4; // Cycle through 0, 1, 2, 3
		dots.textContent = '.'.repeat(dotCount); // Update the dots
	}, 500); // Update every 500ms

	// Send the rawText to the extension
	vscode.postMessage({
		type: 'searchClarifai',
		rawText: rawText
	});
}); 

// Add CSS for the dots
const style = document.createElement('style');
style.textContent = `
	.dots {
		font-size: 24px;
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
	}
`;
document.head.appendChild(style); 