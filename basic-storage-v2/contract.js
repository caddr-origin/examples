function postToParent(value) {
    (window.opener || window.parent).postMessage({ action: 'data', value: value }, '*');
}

function mountHandle(handle){
    let channel = null;

    const getData = () => {
        if(handle && handle.localStorage){
            return handle.localStorage.getItem('data')
        }else{
            const values = Object.fromEntries(document.cookie.split(';').map(k => k.trim().split('=').map(decodeURIComponent)));
            return values['data']
        }
    }

    const setData = (data) => {
        lastValue = data;
        if(handle && handle.localStorage){
            handle.localStorage.setItem('data', data);
            if(channel){
                channel.postMessage(data.value);
            }
        }else{
            document.cookie = 'data=' + encodeURIComponent(data) + ';SameSite=None;Path=/;Secure'
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
        }, 50)
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

let url = new URL(location.href)

if(url.searchParams.get('authPopup')){
    const button = document.createElement('button')
    button.innerText = 'Grant storage access'
    button.style.top = 0;
    button.style.left = 0;
    button.style.position = 'absolute'
    button.style.width = '100vw'
    button.style.height = '100vh'
    button.onclick = () => {
        document.cookie = 'initial=42;SameSite=None;Path=/;Secure'
        window.close()
    }
    document.body.appendChild(button)
}else if(document.hasStorageAccess){
    const launchPopup = () => {
        let url = new URL(location.href)
        url.searchParams.set('authPopup', 'true')
        window.open(url, "_blank", "width=300,height=200,top=100,popup");
    }
    const hasNoAccess = () => {
        const button = document.createElement('button')
        button.innerText = 'Grant storage access'
        button.style.top = 0;
        button.style.left = 0;
        button.style.position = 'absolute'
        button.style.width = '100vw'
        button.style.height = '100vh'
        button.onclick = () => {
            document.requestStorageAccess({all: true}).then(handle => {
                document.cookie = 'test=42;SameSite=None;Path=/;Secure'
                if(document.cookie === ''){
                    launchPopup()
                }else{
                    button.remove()
                    mountHandle(handle)    
                }
            }, (err) => {
                console.error(err)
                launchPopup()
            })
        }
        document.body.appendChild(button)
    }
    document.hasStorageAccess().then(hasAccess => {
        if(!hasAccess){
            hasNoAccess()
        }else{
            document.requestStorageAccess({all: true}).then(handle => {
                mountHandle(handle)
            }, err => {
                hasNoAccess()
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