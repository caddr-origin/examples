function postToParent(value) {
    (window.opener || window.parent).postMessage({ action: 'data', value: value }, '*');
}

function mountHandle(handle){
    let channel = null;

    const getData = () => {
        if(handle && handle.localStorage){
            return handle.localStorage.getItem('data')
        }else{
            const values = Object.fromEntries(document.cookie.split(';').map(k => k.split('=').map(decodeURIComponent)));
            return values['data']
        }
    }

    const setData = (data) => {
        if(handle && handle.localStorage){
            handle.localStorage.setItem('data', data);
            if(channel){
                channel.postMessage(data.value);
            }
        }else{
            document.cookie = 'data=' + encodeURIComponent(data) + ';SameSite=Strict'
        }
    }

    let lastValue = getData()

    if(handle && handle.BroadcastChannel){
        channel = handle.BroadcastChannel('data')
        channel.addEventListener('message', event => {
            postToParent(getData());
        });
    }else{
        // if we dont have broadcast channel we can do polling
        setInterval(() => {
            let newData = getData()
            if(newData !== lastValue){
                lastValue = newData;
                postToParent(newData)
            }
        }, 100)
    }

    postToParent(lastValue)

    window.addEventListener('message', function(event) {
        const data = event.data;
        if (data && data.action) {
            if (data.action === 'save' && data.value !== undefined) {
                setData(data.value);
            } else if (data.action === 'load') {
                postToParent(getData());
            }
        }
    }, false);
}

if(document.hasStorageAccess){
    document.hasStorageAccess().then(hasAccess => {
        if(!hasAccess){
            window.parent.postMessage({ action: 'access-needed' }, '*');
            const button = document.createElement('button')
            button.innerText = 'Grant storage access'
            button.onclick = () => {
                document.requestStorageAccess({all: true}).then(handle => {
                    button.remove()
                    mountHandle(handle)
                }, () => {
                })
            }
            document.body.appendChild(button)
        }else{
            document.requestStorageAccess({all: true}).then(handle => {
                mountHandle(handle)
            })
        }
    })
}else{
    mountHandle({
        localStorage: localStorage,
        BroadcastChannel(prefix){
            return new BroadcastChannel(prefix);
        }
    })
}