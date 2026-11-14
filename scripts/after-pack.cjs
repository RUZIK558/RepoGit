'use strict';
// Embed the same icon in the app executable, including when cross-building on Linux.
const fs=require('node:fs'),path=require('node:path');
const pe=require('pe-library'),resedit=require('resedit');
module.exports=async function(ctx){
 if(ctx.electronPlatformName!=='win32')return;
 const target=path.join(ctx.appOutDir,ctx.packager.appInfo.productFilename+'.exe');
 const executable=pe.NtExecutable.from(fs.readFileSync(target),{ignoreCert:true});
 const res=pe.NtExecutableResource.from(executable);
 const icon=resedit.Data.IconFile.from(fs.readFileSync(path.join(ctx.packager.projectDir,'assets/icon.ico')));
 const groups=res.entries.filter(e=>e.type===14);
 if(!groups.length)throw Error('Windows executable has no icon group');
 for(const group of groups)resedit.Resource.IconGroupEntry.replaceIconsForResource(res.entries,group.id,group.lang,icon.icons.map(i=>i.data));
 res.outputResource(executable);fs.writeFileSync(target,Buffer.from(executable.generate()));
};
