declare module "piexifjs" {
  const piexif: {
    ImageIFD: {
      ImageDescription:number;
      Artist:number;
      Copyright:number;
      DateTime:number;
      Make:number;
      Model:number;
      Software:number;
    };
    ExifIFD: {
      DateTimeOriginal:number;
      DateTimeDigitized:number;
      UserComment:number;
    };
    load(data:string): Record<string, any>;
    dump(data:Record<string, any>): string;
    insert(exif:string,data:string): string;
  };
  export default piexif;
}
