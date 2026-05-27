/**
 * Minimal WebUSB API type declarations.
 * The WebUSB spec is not yet in TypeScript's lib.dom.d.ts.
 */

interface USBEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
  packetSize: number;
}

interface USBAlternateInterface {
  alternateSetting: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  interfaceName: string | null;
  endpoints: USBEndpoint[];
}

interface USBInterface {
  interfaceNumber: number;
  alternate: USBAlternateInterface;
  alternates: USBAlternateInterface[];
  claimed: boolean;
}

interface USBConfiguration {
  configurationValue: number;
  configurationName: string | null;
  interfaces: USBInterface[];
}

interface USBConnectionEvent extends Event {
  device: USBDevice;
}

interface USBTransferResult {
  status: 'ok' | 'stall' | 'babble';
  data?: DataView;
  bytesWritten?: number;
}

interface USBDevice {
  vendorId: number;
  productId: number;
  deviceClass: number;
  deviceSubclass: number;
  deviceProtocol: number;
  deviceVersionMajor: number;
  deviceVersionMinor: number;
  deviceVersionSubminor: number;
  usbVersionMajor: number;
  usbVersionMinor: number;
  usbVersionSubminor: number;
  manufacturerName: string | null;
  productName: string | null;
  serialNumber: string | null;
  configuration: USBConfiguration | null;
  configurations: USBConfiguration[];
  opened: boolean;

  open(): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
  controlTransferIn(setup: USBControlTransferParameters, length: number): Promise<USBTransferResult>;
  controlTransferOut(setup: USBControlTransferParameters, data?: BufferSource): Promise<USBTransferResult>;
  transferIn(endpointNumber: number, length: number): Promise<USBTransferResult>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<USBTransferResult>;
  isochronousTransferIn(endpointNumber: number, packetLengths: number[]): Promise<USBIsochronousTransferResult>;
  isochronousTransferOut(endpointNumber: number, data: BufferSource, packetLengths: number[]): Promise<USBIsochronousTransferResult>;
  clearHalt(direction: 'in' | 'out', endpointNumber: number): Promise<void>;
  reset(): Promise<void>;
}

interface USBIsochronousTransferResult {
  data: DataView | null;
  packets: USBIsochronousTransferPacket[];
}

interface USBIsochronousTransferPacket {
  bytesTransferred: number;
  status: 'ok' | 'stall' | 'babble';
  data: DataView | null;
}

interface USBControlTransferParameters {
  requestType: 'standard' | 'class' | 'vendor';
  recipient: 'device' | 'interface' | 'endpoint' | 'other';
  request: number;
  value: number;
  index: number;
}

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
  serialNumber?: string;
}

interface USB extends EventTarget {
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: { filters: USBDeviceFilter[] }): Promise<USBDevice>;
  onconnect: ((event: USBConnectionEvent) => void) | null;
  ondisconnect: ((event: USBConnectionEvent) => void) | null;
}

interface Navigator {
  readonly usb: USB;
}
