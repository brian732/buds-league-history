/* A small photo detour. Everything stays on the current page. */
(() => {
  const photos = [
    {src:'assets/vault/memory-04.jpg',width:1280,height:960,alt:'Friends gathered for a group photo on a deck at night.'},
    {src:'assets/vault/memory-01.jpg',width:480,height:342,alt:'Friends posing together outside at night, with backpacks and college sweatshirts.'},
    {src:'assets/vault/memory-03.jpg',width:750,height:1334,alt:'A FaceTime screenshot with friends crowding into the camera.'},
    {src:'assets/vault/memory-02.jpg',width:1512,height:2016,alt:'Friends dressed up for a group photo outdoors at night.'}
  ];
  const dialog=document.getElementById('budsVault');
  if(!dialog)return;
  const photo=document.getElementById('vaultPhoto'),counter=document.getElementById('vaultCounter'),announcement=document.getElementById('vaultAnnouncement');
  let index=0,opener=null;
  const thumbnails=document.getElementById('vaultThumbnails');
  photos.forEach((p,i)=>{
    const button=document.createElement('button');button.type='button';button.className='vault-thumbnail';button.setAttribute('aria-label',`View photo ${i+1}`);
    const img=document.createElement('img');img.src=p.src;img.alt='';img.width=p.width;img.height=p.height;img.loading='lazy';button.append(img);button.addEventListener('click',()=>show(i));thumbnails.append(button);
  });
  function show(next){
    index=(next+photos.length)%photos.length;const p=photos[index];
    photo.src=p.src;photo.alt=p.alt;photo.width=p.width;photo.height=p.height;counter.textContent=`${index+1} / ${photos.length}`;
    [...thumbnails.children].forEach((button,i)=>{button.setAttribute('aria-pressed',String(i===index));});
    announcement.textContent=`Photo ${index+1} of ${photos.length}`;
  }
  document.querySelectorAll('[data-open-vault]').forEach(button=>button.addEventListener('click',()=>{
    opener=button;show(index);dialog.showModal();document.body.classList.add('vault-is-open');
  }));
  document.getElementById('closeVault').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{document.body.classList.remove('vault-is-open');opener?.focus({preventScroll:true});});
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  dialog.addEventListener('keydown',e=>{
    if(e.key==='ArrowRight'){e.preventDefault();show(index+1);}
    if(e.key==='ArrowLeft'){e.preventDefault();show(index-1);}
  });
  document.getElementById('vaultPrevious').addEventListener('click',()=>show(index-1));
  document.getElementById('vaultNext').addEventListener('click',()=>show(index+1));
  document.getElementById('vaultShuffle').addEventListener('click',()=>show(index+1+Math.floor(Math.random()*(photos.length-1))));
  show(0);
})();
