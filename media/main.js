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
		// existing cases...
	}
}); 

document.querySelector('.cancel-uploads-button').addEventListener('click', () => {
	// Existing functionality for the button
}); 