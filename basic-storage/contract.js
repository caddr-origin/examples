window.addEventListener('message', function(event) {
    const data = event.data;
    if (data && data.action) {
        if (data.action === 'save' && data.value !== undefined) {
            localStorage.setItem('data', data.value);
        } else if (data.action === 'load') {
            postToParent(localStorage.getItem('data'));
        }
    }
}, false);

window.addEventListener('storage', function(event) {
    if (event.key === 'data') {
        postToParent(event.newValue);
    }
});

function postToParent(value) {
    window.parent.postMessage({ action: 'data', value: value }, '*');
}

postToParent(localStorage.getItem('data'));


if(document.hasStorageAccess){
    document.hasStorageAccess().then(hasAccess => {
        if(!hasAccess){
            window.parent.postMessage({ action: 'access-needed' }, '*');
            const button = document.createElement('button')
            button.innerText = 'Grant storage access'
            button.onclick = () => {
                document.requestStorageAccess().then(() => {
                    button.remove()
                    window.parent.postMessage({ action: 'access-approved' }, '*');
                }, () => {
                    window.parent.postMessage({ action: 'access-rejected' }, '*');
                })
            }
            document.body.appendChild(button)
        }
    })
}